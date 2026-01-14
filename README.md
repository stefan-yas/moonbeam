# Moonbeam 🌙
**A Low-Friction Connection Bot for Long-Distance & Chronic Illness**

Moonbeam is a Telegram bot designed to help partners stay connected when one person has limited energy (e.g., ME/CFS, Long Covid, Burnout). It replaces the pressure of text conversation with simple "Tap-to-Update" buttons.

## ✨ Features
* **Traffic Light System:** 🟢 Good / 🟡 Resting / 🔴 Crash (No text required).
* **Role Awareness:** Automatically detects if you are the "Spoonie" (Patient) or the "Supporter."
* **Magic Link Pairing:** One partner sends a link; the other clicks to connect instantly.
* **Dark Room Mode:** 🌙 Alerts the partner to send voice notes only (light sensitivity support).
* **Heart Ping:** ❤️ Send a silent "thinking of you" notification.

## 🛠️ Tech Stack
* **Node.js** & **Telegraf.js** (Bot Logic)
* **Redis** (Database for persistent user pairing)
* **Railway/Render** (Recommended for hosting)

## 🚀 Deployment Guide

### Prerequisites
1.  **Telegram Bot Token:** Get this from [@BotFather](https://t.me/BotFather).
2.  **Redis Database:** Create a free Redis instance on [Upstash](https://upstash.com/) or Railway.

### Local Setup
1.  Clone the repo:
    ```bash
    git clone [https://github.com/YOUR_USERNAME/moonbeam-bot.git](https://github.com/YOUR_USERNAME/moonbeam-bot.git)
    cd moonbeam-bot
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Create a `.env` file:
    ```env
    BOT_TOKEN=123456:ABC-DEF...
    REDIS_URL=redis://default:password@...
    ```
4.  Run the bot:
    ```bash
    npm start
    ```

### Cloud Deployment (Railway/Render)
1.  Fork this repository.
2.  Connect your GitHub account to Railway or Render.
3.  Add the `BOT_TOKEN` and `REDIS_URL` in the "Environment Variables" settings.
4.  Deploy! The bot will run 24/7.

## 🤝 Contributing
Built with love. Feel free to fork and adapt for your own relationships.