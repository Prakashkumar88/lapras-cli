import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro, confirm } from "@clack/prompts";
import { getStoredToken } from "../commands/auth/login.js";
import { apiGet, apiPost } from "../api-client.js";
import { generateApplication } from "../../config/agent.config.js";
import { AIService } from "../ai/google-service.js";
import yoctoSpinner from "yocto-spinner";

// Note: agent mode still needs AIService for structured generation (generateApplication).
// Unlike chat mode, this calls generateObject which cannot be streamed via a simple HTTP text endpoint.
// We keep AIService here but it is only used locally in agent mode when env vars are present,
// or it will gracefully fail if the key is missing.
let aiService = null;
try {
  aiService = new AIService();
} catch {
  // Will be caught when the user tries to start agent mode
}

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'lapras login' first.");
  }

  try {
    const user = await apiGet("/api/me", token.access_token);
    console.log(chalk.green(`\n✓ Welcome back, ${user.name}!\n`));
    return { user, token: token.access_token };
  } catch {
    throw new Error("User not found. Please login again.");
  }
}

async function initConversation(token, userId, conversationId = null) {
  let conversation;
  if (conversationId) {
    try { conversation = await apiGet(`/api/conversations/${conversationId}`, token); } catch {}
  }
  if (!conversation) {
    conversation = await apiPost("/api/conversations", token, { mode: "agent" });
  }

  const conversationInfo = boxen(
    `${chalk.bold("Conversation")}: ${conversation.title}\n` +
    `${chalk.gray("ID:")} ${conversation.id}\n` +
    `${chalk.gray("Mode:")} ${chalk.magenta("Agent (Code Generator)")}\n` +
    `${chalk.cyan("Working Directory:")} ${process.cwd()}`,
    {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "magenta",
      title: "🤖 Agent Mode",
      titleAlignment: "center",
    }
  );
  console.log(conversationInfo);

  return conversation;
}

async function saveMessage(token, conversationId, role, content) {
  return await apiPost(`/api/conversations/${conversationId}/messages`, token, { role, content });
}

async function agentLoop(token, conversation) {
  const helpBox = boxen(
    `${chalk.cyan.bold("What can the agent do?")}\n\n` +
    `${chalk.gray('• Generate complete applications from descriptions')}\n` +
    `${chalk.gray('• Create all necessary files and folders')}\n` +
    `${chalk.gray('• Include setup instructions and commands')}\n` +
    `${chalk.gray('• Generate production-ready code')}\n\n` +
    `${chalk.yellow.bold("Examples:")}\n` +
    `${chalk.white('• "Build a todo app with React and Tailwind"')}\n` +
    `${chalk.white('• "Create a REST API with Express and MongoDB"')}\n` +
    `${chalk.white('• "Make a weather app using OpenWeatherMap API"')}\n\n` +
    `${chalk.gray('Type "exit" to end the session')}`,
    {
      padding: 1,
      margin: { bottom: 1 },
      borderStyle: "round",
      borderColor: "cyan",
      title: "💡 Agent Instructions",
    }
  );
  console.log(helpBox);

  while (true) {
    const userInput = await text({
      message: chalk.magenta("🤖 What would you like to build?"),
      placeholder: "Describe your application...",
      validate(value) {
        if (!value || value.trim().length === 0) return "Description cannot be empty";
        if (value.trim().length < 10) return "Please provide more details (at least 10 characters)";
      },
    });

    if (isCancel(userInput)) {
      console.log(chalk.yellow("\n👋 Agent session cancelled\n"));
      process.exit(0);
    }

    if (userInput.toLowerCase() === "exit") {
      console.log(chalk.yellow("\n👋 Agent session ended\n"));
      break;
    }

    const userBox = boxen(chalk.white(userInput), {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "blue",
      title: "👤 Your Request",
      titleAlignment: "left",
    });
    console.log(userBox);

    await saveMessage(token, conversation.id, "user", userInput);

    if (!aiService) {
      console.log(chalk.red("\n❌ Agent mode requires GOOGLE_API_KEY to be set on the server.\n"));
      break;
    }

    try {
      const result = await generateApplication(userInput, aiService, process.cwd());

      if (result && result.success) {
        const responseMessage = `Generated application: ${result.folderName}\n` +
          `Files created: ${result.files.length}\nLocation: ${result.appDir}\n\n` +
          `Setup commands:\n${result.commands.join('\n')}`;

        await saveMessage(token, conversation.id, "assistant", responseMessage);

        const continuePrompt = await confirm({
          message: chalk.cyan("Would you like to generate another application?"),
          initialValue: false,
        });

        if (isCancel(continuePrompt) || !continuePrompt) {
          console.log(chalk.yellow("\n👋 Great! Check your new application.\n"));
          break;
        }
      } else {
        throw new Error("Generation returned no result");
      }
    } catch (error) {
      console.log(chalk.red(`\n❌ Error: ${error.message}\n`));
      await saveMessage(token, conversation.id, "assistant", `Error: ${error.message}`);

      const retry = await confirm({ message: chalk.cyan("Would you like to try again?"), initialValue: true });
      if (isCancel(retry) || !retry) break;
    }
  }
}

export async function startAgentChat(conversationId = null) {
  try {
    intro(
      boxen(
        chalk.bold.magenta("🤖 Lapras AI - Agent Mode\n\n") +
        chalk.gray("Autonomous Application Generator"),
        { padding: 1, borderStyle: "double", borderColor: "magenta" }
      )
    );

    const { user, token } = await getUserFromToken();

    const shouldContinue = await confirm({
      message: chalk.yellow("⚠️  The agent will create files and folders in the current directory. Continue?"),
      initialValue: true,
    });

    if (isCancel(shouldContinue) || !shouldContinue) {
      cancel(chalk.yellow("Agent mode cancelled"));
      process.exit(0);
    }

    const conversation = await initConversation(token, user.id, conversationId);
    await agentLoop(token, conversation);

    outro(chalk.green.bold("\n✨ Thanks for using Agent Mode!"));
  } catch (error) {
    const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "red",
    });
    console.log(errorBox);
    process.exit(1);
  }
}