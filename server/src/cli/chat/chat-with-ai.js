import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { getStoredToken } from "../commands/auth/login.js";
import { LAPRAS_SERVER_URL, apiGet, apiPost, apiRequest } from "../api-client.js";

// Configure marked to use terminal renderer
marked.use(
  markedTerminal({
    code: chalk.cyan,
    blockquote: chalk.gray.italic,
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    hr: chalk.reset,
    listitem: chalk.reset,
    list: chalk.reset,
    paragraph: chalk.reset,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.yellow.bgBlack,
    del: chalk.dim.gray.strikethrough,
    link: chalk.blue.underline,
    href: chalk.blue.underline,
  })
);

async function getUserFromToken() {
  const token = await getStoredToken();

  if (!token?.access_token) {
    throw new Error("Not authenticated. Please run 'lapras login' first.");
  }

  const spinner = yoctoSpinner({ text: "Fetching User Information..." }).start();

  try {
    const user = await apiGet("/api/me", token.access_token);
    spinner.success(`Welcome back, ${user.name}!`);
    return { user, token: token.access_token };
  } catch (err) {
    spinner.error("Authentication failed");
    throw new Error("User not found. Please login again.");
  }
}

async function initConversation(token, userId, conversationId = null, mode = "chat") {
  const spinner = yoctoSpinner({ text: "Loading conversation..." }).start();

  let conversation;
  if (conversationId) {
    try {
      conversation = await apiGet(`/api/conversations/${conversationId}`, token);
    } catch {
      // fall through to create
    }
  }

  if (!conversation) {
    conversation = await apiPost("/api/conversations", token, { mode });
  }

  spinner.success("Conversation loaded");

  const conversationInfo = boxen(
    `${chalk.bold("Conversation")}: ${conversation.title}\n${chalk.gray("ID: " + conversation.id)}\n${chalk.gray("Mode: " + conversation.mode)}`,
    {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "cyan",
      title: "💬 Chat Session",
      titleAlignment: "center",
    }
  );
  console.log(conversationInfo);

  if (conversation.messages?.length > 0) {
    console.log(chalk.yellow("📜 Previous messages:\n"));
    displayMessages(conversation.messages);
  }

  return conversation;
}

function displayMessages(messages) {
  messages.forEach((msg) => {
    if (msg.role === "user") {
      const userBox = boxen(chalk.white(msg.content), {
        padding: 1,
        margin: { left: 2, bottom: 1 },
        borderStyle: "round",
        borderColor: "blue",
        title: "👤 You",
        titleAlignment: "left",
      });
      console.log(userBox);
    } else {
      const renderedContent = marked.parse(msg.content);
      const assistantBox = boxen(renderedContent.trim(), {
        padding: 1,
        margin: { left: 2, bottom: 1 },
        borderStyle: "round",
        borderColor: "green",
        title: "🤖 Assistant",
        titleAlignment: "left",
      });
      console.log(assistantBox);
    }
  });
}

async function saveUserMessage(token, conversationId, content) {
  return await apiPost(`/api/conversations/${conversationId}/messages`, token, {
    role: "user",
    content,
  });
}

async function getAIResponse(token, conversationId, messages) {
  const spinner = yoctoSpinner({
    text: "AI is thinking...",
    color: "cyan",
  }).start();

  const res = await apiRequest(`/api/conversations/${conversationId}/chat`, token, {
    method: "POST",
    body: JSON.stringify({ messages }),
  });

  // Stream the text response
  let fullResponse = "";
  let isFirstChunk = true;
  const decoder = new TextDecoder();

  for await (const chunk of res.body) {
    const text = decoder.decode(chunk, { stream: true });
    if (isFirstChunk) {
      spinner.stop();
      console.log("\n");
      console.log(chalk.green.bold("🤖 Assistant:"));
      console.log(chalk.gray("─".repeat(60)));
      isFirstChunk = false;
    }
    fullResponse += text;
    process.stdout.write(text);
  }

  console.log("\n\n");
  console.log(chalk.gray("─".repeat(60)));
  console.log("\n");

  return fullResponse;
}

async function chatLoop(token, conversation) {
  const helpBox = boxen(
    `${chalk.gray('• Type your message and press Enter')}\n${chalk.gray('• Markdown formatting is supported in responses')}\n${chalk.gray('• Type "exit" to end conversation')}\n${chalk.gray('• Press Ctrl+C to quit anytime')}`,
    {
      padding: 1,
      margin: { bottom: 1 },
      borderStyle: "round",
      borderColor: "gray",
      dimBorder: true,
    }
  );
  console.log(helpBox);

  // Build message history from existing messages
  const messageHistory = (conversation.messages || []).map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));

  while (true) {
    const userInput = await text({
      message: chalk.blue("💬 Your message"),
      placeholder: "Type your message...",
      validate(value) {
        if (!value || value.trim().length === 0) {
          return "Message cannot be empty";
        }
      },
    });

    if (isCancel(userInput)) {
      const exitBox = boxen(chalk.yellow("Chat session ended. Goodbye! 👋"), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "yellow",
      });
      console.log(exitBox);
      process.exit(0);
    }

    if (userInput.toLowerCase() === "exit") {
      const exitBox = boxen(chalk.yellow("Chat session ended. Goodbye! 👋"), {
        padding: 1,
        margin: 1,
        borderStyle: "round",
        borderColor: "yellow",
      });
      console.log(exitBox);
      break;
    }

    // Add to local history and persist
    messageHistory.push({ role: "user", content: userInput });
    await saveUserMessage(token, conversation.id, userInput);

    // Update title after first message
    if (messageHistory.filter(m => m.role === "user").length === 1) {
      const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
      apiPost(`/api/conversations/${conversation.id}/title`, token, { title }).catch(() => {});
    }

    // Get AI response (server handles streaming + persistence)
    const aiResponse = await getAIResponse(token, conversation.id, messageHistory);
    messageHistory.push({ role: "assistant", content: aiResponse });
  }
}

// Main entry point
export async function startChat(mode = "chat", conversationId = null) {
  try {
    intro(
      boxen(chalk.bold.cyan("🦖 Lapras AI Chat"), {
        padding: 1,
        borderStyle: "double",
        borderColor: "cyan",
      })
    );

    const { user, token } = await getUserFromToken();
    const conversation = await initConversation(token, user.id, conversationId, mode);
    await chatLoop(token, conversation);

    outro(chalk.green("✨ Thanks for chatting!"));
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