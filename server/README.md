<div align="center">
  <img src="https://raw.githubusercontent.com/Prakashkumar88/lapras-cli/master/client/public/login.svg" alt="Lapras Logo" height="200" />
</div>

# Lapras CLI

Lapras is a terminal-based AI Assistant designed to run seamlessly from your command line. Powered by Gemini, PostgreSQL, and Next.js Auth, it brings a full-featured conversational AI right to your fingertips.

## 🚀 Installation

Lapras CLI is distributed via NPM. You can install it globally on any machine using:

```bash
npm install -g lapras-cli
```

## 💻 Usage

Once installed globally, simply type the following command anywhere in your terminal to start the AI prompt:

```bash
lapras wakeup
```

### Authentication
On your first run, Lapras uses a secure Device Authorization Flow. It will provide a 6-digit code and prompt you to visit the Lapras Web Portal to log in with GitHub. Once authorized in your browser, the CLI instantly connects to your database and begins the chat!

## 🛠️ Features
- **Global Availability:** Type `lapras` anywhere in your filesystem.
- **Secure Device Flow Auth:** Modern web-based CLI authentication using GitHub OAuth.
- **Persistent Memory:** Conversations are securely saved to a PostgreSQL database powered by Prisma.
- **Google Gemini Engine:** High quality LLM chat responses.

## 📚 Stack
*   **CLI Engine:** Node.js, Commander, Clack Prompts
*   **Authentication:** Better Auth (Cross-Domain Device Flow)
*   **Database:** PostgreSQL (Neon), Prisma ORM
*   **Frontend Web:** Next.js (Vercel)
*   **Backend Server:** Express (Render)

---
*Created by [Prakash Kumar](https://github.com/Prakashkumar88)*
