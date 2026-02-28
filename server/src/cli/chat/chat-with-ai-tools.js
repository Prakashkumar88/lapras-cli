import chalk from "chalk";
import boxen from "boxen";
import { text, isCancel, cancel, intro, outro, multiselect } from "@clack/prompts";
import yoctoSpinner from "yocto-spinner";
import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import { getStoredToken } from "../commands/auth/login.js";
import { apiGet, apiPost, apiRequest } from "../api-client.js";
import { 
  availableTools, 
  getEnabledTools, 
  enableTools, 
  getEnabledToolNames,
  resetTools 
} from "../../config/tool.config.js";

// Configure marked for terminal
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

  const spinner = yoctoSpinner({ text: "Authenticating..." }).start();

  try {
    const user = await apiGet("/api/me", token.access_token);
    spinner.success(`Welcome back, ${user.name}!`);
    return { user, token: token.access_token };
  } catch {
    spinner.error("User not found");
    throw new Error("User not found. Please login again.");
  }
}

async function selectTools() {
  const toolOptions = availableTools.map(tool => ({
    value: tool.id,
    label: tool.name,
    hint: tool.description,
  }));

  const selectedTools = await multiselect({
    message: chalk.cyan("Select tools to enable (Space to select, Enter to confirm):"),
    options: toolOptions,
    required: false,
  });

  if (isCancel(selectedTools)) {
    cancel(chalk.yellow("Tool selection cancelled"));
    process.exit(0);
  }

  // Enable selected tools
  enableTools(selectedTools);

  if (selectedTools.length === 0) {
    console.log(chalk.yellow("\n⚠️  No tools selected. AI will work without tools.\n"));
  } else {
    const toolsBox = boxen(
      chalk.green(`✅ Enabled tools:\n${selectedTools.map(id => {
        const tool = availableTools.find(t => t.id === id);
        return `  • ${tool.name}`;
      }).join('\n')}`),
      {
        padding: 1,
        margin: { top: 1, bottom: 1 },
        borderStyle: "round",
        borderColor: "green",
        title: "🛠️  Active Tools",
        titleAlignment: "center",
      }
    );
    console.log(toolsBox);
  }

  return selectedTools.length > 0;
}

async function initConversation(token, userId, conversationId = null, mode = "tool") {
  const spinner = yoctoSpinner({ text: "Loading conversation..." }).start();

  let conversation;
  if (conversationId) {
    try { conversation = await apiGet(`/api/conversations/${conversationId}`, token); } catch {}
  }
  if (!conversation) {
    conversation = await apiPost("/api/conversations", token, { mode });
  }
  
  spinner.success("Conversation loaded");
  
  // Get enabled tool names for display
  const enabledToolNames = getEnabledToolNames();
  const toolsDisplay = enabledToolNames.length > 0 
    ? `\n${chalk.gray("Active Tools:")} ${enabledToolNames.join(", ")}`
    : `\n${chalk.gray("No tools enabled")}`;
  
  // Display conversation info in a box
  const conversationInfo = boxen(
    `${chalk.bold("Conversation")}: ${conversation.title}\n${chalk.gray("ID: " + conversation.id)}\n${chalk.gray("Mode: " + conversation.mode)}${toolsDisplay}`,
    {
      padding: 1,
      margin: { top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "cyan",
      title: "💬 Tool Calling Session",
      titleAlignment: "center",
    }
  );
  
  console.log(conversationInfo);
  
  // Display existing messages if any
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
    } else if (msg.role === "assistant") {
      const renderedContent = marked.parse(msg.content);
      const assistantBox = boxen(renderedContent.trim(), {
        padding: 1,
        margin: { left: 2, bottom: 1 },
        borderStyle: "round",
        borderColor: "green",
        title: "🤖 Assistant (with tools)",
        titleAlignment: "left",
      });
      console.log(assistantBox);
    }
  });
}

async function saveMessage(token, conversationId, role, content) {
  return await apiPost(`/api/conversations/${conversationId}/messages`, token, { role, content });
}

async function getAIResponse(token, conversationId, messageHistory) {
  const spinner = yoctoSpinner({ 
    text: "AI is thinking...", 
    color: "cyan" 
  }).start();

  const res = await apiRequest(`/api/conversations/${conversationId}/chat`, token, {
    method: "POST",
    body: JSON.stringify({ messages: messageHistory }),
  });

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


async function updateConversationTitle(token, conversationId, userInput, messageCount) {
  if (messageCount === 1) {
    const title = userInput.slice(0, 50) + (userInput.length > 50 ? "..." : "");
    apiPost(`/api/conversations/${conversationId}/title`, token, { title }).catch(() => {});
  }
}

async function chatLoop(token, conversation) {
  const enabledToolNames = getEnabledToolNames();
  const helpBox = boxen(
    `${chalk.gray('• Type your message and press Enter')}\n${chalk.gray('• AI has access to:')} ${enabledToolNames.length > 0 ? enabledToolNames.join(", ") : "No tools"}\n${chalk.gray('• Type "exit" to end conversation')}\n${chalk.gray('• Press Ctrl+C to quit anytime')}`,
    {
      padding: 1,
      margin: { bottom: 1 },
      borderStyle: "round",
      borderColor: "gray",
      dimBorder: true,
    }
  );
  
  console.log(helpBox);

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

    const userBox = boxen(chalk.white(userInput), {
      padding: 1,
      margin: { left: 2, top: 1, bottom: 1 },
      borderStyle: "round",
      borderColor: "blue",
      title: "👤 You",
      titleAlignment: "left",
    });
    console.log(userBox);

    messageHistory.push({ role: "user", content: userInput });
    await saveMessage(token, conversation.id, "user", userInput);
    const aiResponse = await getAIResponse(token, conversation.id, messageHistory);
    messageHistory.push({ role: "assistant", content: aiResponse });
    await updateConversationTitle(token, conversation.id, userInput, messageHistory.filter(m => m.role === "user").length);
  }
}

export async function startToolChat(conversationId = null) {
  try {
    intro(
      boxen(chalk.bold.cyan("🛠️  Lapras AI - Tool Calling Mode"), {
        padding: 1,
        borderStyle: "double",
        borderColor: "cyan",
      })
    );

    const { user, token } = await getUserFromToken();
    
    // Select tools
    await selectTools();
    
    const conversation = await initConversation(token, user.id, conversationId, "tool");
    await chatLoop(token, conversation);
    
    // Reset tools on exit
    resetTools();
    
    outro(chalk.green("✨ Thanks for using tools!"));
  } catch (error) {
    const errorBox = boxen(chalk.red(`❌ Error: ${error.message}`), {
      padding: 1,
      margin: 1,
      borderStyle: "round",
      borderColor: "red",
    });
    console.log(errorBox);
    resetTools();
    process.exit(1);
  }
}