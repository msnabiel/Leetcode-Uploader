import { Octokit } from '@octokit/core';
import { NextResponse } from 'next/server';

interface UploadData {
  code: string;
  difficulty: string;
  topics: string[];
  name: string;
  leetcodeNumber: string;
  extension: string;
}

const token = process.env.GITHUB_TOKEN; // GitHub Authentication token

// Instantiate Octokit with authentication token
const octokit = new Octokit({ auth: token });

// Define constants for repository owner and name
const REPO_OWNER = 'msnabiel';
const REPO_NAME = 'LeetCode';

// GitHub file content response type
interface FileContent {
  type: 'file';
  sha: string;
  path: string;
}

// Function to upload the solution to GitHub
async function uploadToGitHub({ code, difficulty, topics, name, leetcodeNumber, extension }: UploadData) {
  const fileName = `${leetcodeNumber}-${name}${extension}`;
  const capitalizedDifficulty = difficulty.charAt(0).toUpperCase() + difficulty.slice(1).toLowerCase();
  const difficultyFilePath = `${capitalizedDifficulty}/${fileName}`;
  const content = Buffer.from(code).toString('base64');

  // Upload to difficulty folder
  await uploadFile(difficultyFilePath, content, `Add ${fileName} solution under ${capitalizedDifficulty}`);

  // Sequentially upload to each topic folder
  const topicPaths: string[] = [];
  for (const topic of topics) {
    const formattedTopic = topic
      .toLowerCase()
      .replace(/ /g, '_')
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join('_');
    
    const topicFilePath = `Topics/${formattedTopic}/${fileName}`;
    await uploadFile(topicFilePath, content, `Add ${fileName} solution under ${formattedTopic}`);
    topicPaths.push(topicFilePath);
  }

  return { 
    success: true, 
    filePaths: [difficultyFilePath, ...topicPaths] 
  };
}

// Helper function to upload a file with retry mechanism
async function uploadFile(filePath: string, content: string, message: string, retryCount = 3) {
  for (let attempt = 1; attempt <= retryCount; attempt++) {
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', {
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filePath,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28',
          'If-None-Match': '', // Force fresh data
          'Cache-Control': 'no-cache'
        }
      }).catch(error => {
        if (error.status === 404) {
          return null; // File doesn't exist
        }
        throw error;
      });

      const requestParams = {
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: filePath,
        message: message,
        content: content,
        headers: {
          'X-GitHub-Api-Version': '2022-11-28'
        }
      };

      if (response?.data) {
        const existingFile = response.data as FileContent;
        await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
          ...requestParams,
          sha: existingFile.sha,
        });
      } else {
        await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', requestParams);
      }

      return;

    } catch (error) {
      if (error instanceof Error && error.status === 409 && attempt < retryCount) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        continue;
      }
      console.error(`Error uploading file ${filePath} (attempt ${attempt}/${retryCount}):`, error);
      throw error;
    }
  }
}

// API route handler for App Router
export async function POST(request: Request) {
  try {
    const data = await request.json();
    const { code, difficulty, topics, name, leetcodeNumber, extension } = data;

    // Ensure all required fields are provided
    if (!code || !difficulty || !topics?.length || !name || !leetcodeNumber || !extension) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Call the function to upload the solution to GitHub
    const result = await uploadToGitHub({
      code,
      difficulty,
      topics,
      name,
      leetcodeNumber,
      extension,
    });

    // Check if result contains filePaths and return the appropriate response
    if (result.success && result.filePaths) {
      return NextResponse.json({
        message: `Solution uploaded successfully to ${result.filePaths.join(', ')}`
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Error uploading solution to GitHub' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
