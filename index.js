require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Redis = require('ioredis');

// --- CONFIGURATION ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

// --- DATABASE HELPERS ---
// Keys are stored as "user:12345"
// Values are JSON strings: '{"role":"spoonie", "partnerId":"6789"}'

async function getUser(id) {
    try {
        const data = await redis.get(`user:${id}`);
        return data ? JSON.parse(data) : null;
    } catch (err) {
        console.error("Redis Get Error:", err);
        return null;
    }
}

async function saveUser(id, newData) {
    try {
        const current = await getUser(id) || {};
        const updated = { ...current, ...newData };
        await redis.set(`user:${id}`, JSON.stringify(updated));
    } catch (err) {
        console.error("Redis Save Error:", err);
    }
}

// --- MENUS ---

// 1. The Spoonie Menu (Energy Management)
const spoonieMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Good Energy', 'status_green')],
    [Markup.button.callback('🟡 Resting / Low', 'status_yellow')],
    [Markup.button.callback('🔴 Crash / PEM', 'status_red')],
    [Markup.button.callback('🌙 Dark Room', 'mode_dark'), Markup.button.callback('❤️ Send Heart', 'send_heart')]
]);

// 2. The Supporter Menu (Connection & Nudges)
const supporterMenu = Markup.inlineKeyboard([
    [Markup.button.callback('❤️ Thinking of You', 'send_heart'), Markup.button.callback('🫂 Big Hug', 'send_hug')],
    [Markup.button.callback('☀️ Good Morning', 'send_morning'), Markup.button.callback('🌙 Good Night', 'send_night')],
    [Markup.button.callback('❓ Gentle Status Check', 'req_checkin')]
]);

// --- ONBOARDING FLOW ---

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const payload = ctx.startPayload; // The invite code (partner's ID)

    // 1. Get current user data from Cloud
    const user = await getUser(userId);

    // CASE A: User is already registered & paired
    if (user && user.partnerId) {
        const menu = user.role === 'spoonie' ? spoonieMenu : supporterMenu;
        return ctx.reply("Welcome back, Moonbeam. 🌙", menu);
    }

    // CASE B: User is joining via Magic Link
    if (payload && payload !== userId) {
        const inviter = await getUser(payload);

        if (inviter) {
            // Determine Role (Opposite of Inviter)
            const myRole = (inviter.role === 'spoonie') ? 'supporter' : 'spoonie';

            // Link them in Redis
            await saveUser(userId, { role: myRole, partnerId: payload });
            await saveUser(payload, { partnerId: userId });

            // Notify Inviter
            bot.telegram.sendMessage(payload, "✨ Your partner has connected! You are linked.");

            // Show Joiner their menu
            const menu = myRole === 'spoonie' ? spoonieMenu : supporterMenu;
            return ctx.reply("✨ Connected! You are now linked.\n\nHere are your controls:", menu);
        }
    }

    // CASE C: New User (Initiator)
    ctx.reply(
        "Welcome to Moonbeam. 🌙\n\nTo tailor the experience, please tell me: \nDo you live with ME/CFS, or are you the supporter?",
        Markup.inlineKeyboard([
            [Markup.button.callback('I have ME/CFS (Spoonie)', 'set_role_spoonie')],
            [Markup.button.callback('I am the Supporter', 'set_role_supporter')]
        ])
    );
});

// --- ROLE HANDLERS ---

bot.action('set_role_spoonie', async (ctx) => {
    const userId = ctx.from.id.toString();
    await saveUser(userId, { role: 'spoonie' });
    sendInviteLink(ctx);
});

bot.action('set_role_supporter', async (ctx) => {
    const userId = ctx.from.id.toString();
    await saveUser(userId, { role: 'supporter' });
    sendInviteLink(ctx);
});

function sendInviteLink(ctx) {
    const userId = ctx.from.id.toString();
    const botUsername = ctx.botInfo.username;
    const link = `https://t.me/${botUsername}?start=${userId}`;

    ctx.editMessageText(
        `Got it! 🌙\n\nNow, send this Magic Link to your partner.\n` +
        `When they click it, they will be automatically set up.\n\n` +
        `🔗 ${link}`
    );
}

// --- COMMUNICATION LOGIC ---

// Helper: Sends a message to the partner
const notifyPartner = async (ctx, message, extraOptions = {}) => {
    const userId = ctx.from.id.toString();
    const user = await getUser(userId);

    if (!user || !user.partnerId) {
        return ctx.reply("⚠️ You aren't connected yet. Type /start to get your link.");
    }

    bot.telegram.sendMessage(user.partnerId, message, { parse_mode: 'Markdown', ...extraOptions })
        .then(() => ctx.answerCbQuery("Sent! 🌙"))
        .catch((err) => {
            console.error(err);
            ctx.answerCbQuery("Error: Could not reach partner.");
        });
};

// --- SPOONIE ACTIONS ---
bot.action('status_green', (ctx) => notifyPartner(ctx, "🟢 *Energy Update:* \nFeeling good! Ready to chat."));
bot.action('status_yellow', (ctx) => notifyPartner(ctx, "🟡 *Energy Update:* \nResting. Low interaction only."));
bot.action('status_red', (ctx) => notifyPartner(ctx, "🔴 *Energy Update:* \nIn a Crash/PEM. No screens. I will reach out when I can."));
bot.action('mode_dark', (ctx) => notifyPartner(ctx, "🌙 *Dark Room Mode:* \nLight sensitive. Please send voice notes only."));

// --- SUPPORTER ACTIONS ---
bot.action('send_heart', (ctx) => notifyPartner(ctx, "❤️ *Thinking of you.* (No reply needed)"));
bot.action('send_hug', (ctx) => notifyPartner(ctx, "🫂 *Sending you a warm, gentle hug.*"));
bot.action('send_morning', (ctx) => notifyPartner(ctx, "☀️ *Good morning my love.* I hope you rested well."));
bot.action('send_night', (ctx) => notifyPartner(ctx, "🌙 *Good night.* Sleep well and recharge."));

// The "Smart Check-in"
bot.action('req_checkin', async (ctx) => {
    const userId = ctx.from.id.toString();
    const user = await getUser(userId);

    if (!user || !user.partnerId) {
        return ctx.reply("⚠️ Not connected yet.");
    }

    ctx.answerCbQuery("Check-in sent! 🌙");

    // Send message to partner WITH the buttons attached
    bot.telegram.sendMessage(
        user.partnerId,
        "❓ *Gentle Check-in:* \nHow is your energy envelope right now? \n(Tap below when you can)",
        {
            parse_mode: 'Markdown',
            ...spoonieMenu
        }
    ).catch(err => console.log("Failed to reach partner", err));
});

// --- STARTUP ---
bot.launch().then(() => {
    console.log("Moonbeam (Pro/Redis) is running...");
});

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));