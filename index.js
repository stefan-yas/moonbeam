require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Redis = require('ioredis');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Connect to the Cloud Database
const redis = new Redis(process.env.REDIS_URL);

// --- DB HELPER FUNCTIONS ---
// We use "keys" in Redis like: "user:12345"
// The value will be a JSON string: '{"role":"spoonie", "partnerId":"6789"}'

async function getUser(id) {
    const data = await redis.get(`user:${id}`);
    return data ? JSON.parse(data) : null;
}

async function saveUser(id, newData) {
    const current = await getUser(id) || {};
    const updated = { ...current, ...newData };
    await redis.set(`user:${id}`, JSON.stringify(updated));
}

// --- MENUS ---
const spoonieMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Good Energy', 'status_green')],
    [Markup.button.callback('🟡 Resting / Low', 'status_yellow')],
    [Markup.button.callback('🔴 Crash / PEM', 'status_red')],
    [Markup.button.callback('🌙 Dark Room', 'mode_dark'), Markup.button.callback('❤️ Send Heart', 'send_heart')]
]);

const supporterMenu = Markup.inlineKeyboard([
    [Markup.button.callback('❤️ Send Love', 'send_heart')],
    [Markup.button.callback('🫂 Sending Gentle Hugs', 'send_hug')],
    [Markup.button.callback('❓ Request Check-in (Softly)', 'req_checkin')]
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
        // check if the inviter exists
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
// These functions are now async because we must save to Redis

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

    // We use editMessageText so we don't spam the chat history
    ctx.editMessageText(
        `Got it! 🌙\n\nNow, send this Magic Link to your partner.\n` +
        `When they click it, they will be automatically set up.\n\n` +
        `🔗 ${link}`
    );
}

// --- COMMUNICATION LOGIC ---

const notifyPartner = async (ctx, message) => {
    const userId = ctx.from.id.toString();

    // Fetch fresh data from Redis
    const user = await getUser(userId);

    if (!user || !user.partnerId) {
        return ctx.reply("⚠️ You aren't connected yet. Type /start to get your link.");
    }

    bot.telegram.sendMessage(user.partnerId, message)
        .then(() => ctx.answerCbQuery("Sent! 🌙"))
        .catch((err) => {
            console.error(err);
            ctx.answerCbQuery("Error: Could not reach partner.");
        });
};

// Spoonie Actions
bot.action('status_green', (ctx) => notifyPartner(ctx, "🟢 Energy Update: Feeling good! Ready to chat."));
bot.action('status_yellow', (ctx) => notifyPartner(ctx, "🟡 Energy Update: Resting. Low interaction only."));
bot.action('status_red', (ctx) => notifyPartner(ctx, "🔴 Energy Update: In a Crash/PEM. No screens. I will reach out when I can."));
bot.action('mode_dark', (ctx) => notifyPartner(ctx, "🌙 Dark Room Mode: Please send voice notes only."));

// Supporter Actions
bot.action('send_heart', (ctx) => notifyPartner(ctx, "❤️ Thinking of you."));
bot.action('send_hug', (ctx) => notifyPartner(ctx, "🫂 Sending you a gentle hug."));
bot.action('req_checkin', (ctx) => notifyPartner(ctx, "Thinking of you. No pressure, but if you have energy for a tap, let me know how you are. ❤️"));

bot.launch();
console.log("Moonbeam (Pro/Redis) is running...");

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));