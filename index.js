require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const Redis = require('ioredis');

// --- CONFIGURATION ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

// --- DATABASE HELPERS ---
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
const spoonieMenu = Markup.inlineKeyboard([
    [Markup.button.callback('🟢 Good Energy', 'status_green')],
    [Markup.button.callback('🟡 Resting / Low', 'status_yellow')],
    [Markup.button.callback('🔴 Crash / PEM', 'status_red')],
    [Markup.button.callback('🌙 Dark Room', 'mode_dark'), Markup.button.callback('❤️ Send Heart', 'send_heart')]
]);

const supporterMenu = Markup.inlineKeyboard([
    [Markup.button.callback('❤️ Thinking of You', 'send_heart'), Markup.button.callback('🫂 Big Hug', 'send_hug')],
    [Markup.button.callback('☀️ Good Morning', 'send_morning'), Markup.button.callback('🌙 Good Night', 'send_night')],
    [Markup.button.callback('❓ Gentle Status Check', 'req_checkin')]
]);

// --- ONBOARDING FLOW ---

bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || 'Partner'; // Capture the name
    const payload = ctx.startPayload;

    // Always update the name in the DB just in case it changed
    await saveUser(userId, { firstName });

    // 1. Get current user data
    const user = await getUser(userId);

    // CASE A: User is already registered & paired
    if (user && user.partnerId) {
        const menu = user.role === 'spoonie' ? spoonieMenu : supporterMenu;
        return ctx.reply(`Welcome back, ${user.firstName}. 🌙`, menu);
    }

    // CASE B: User is joining via Magic Link
    if (payload && payload !== userId) {
        const inviter = await getUser(payload);

        if (inviter) {
            const myRole = (inviter.role === 'spoonie') ? 'supporter' : 'spoonie';

            // Link them in Redis
            await saveUser(userId, { role: myRole, partnerId: payload, firstName });
            await saveUser(payload, { partnerId: userId }); // Update inviter link

            // Notify Inviter (The Partner) that YOU joined
            const inviterMenu = (inviter.role === 'spoonie') ? spoonieMenu : supporterMenu;
            bot.telegram.sendMessage(
                payload,
                `✨ *${firstName}* has connected! You are linked.\n\nHere is your menu:`,
                { parse_mode: 'Markdown', ...inviterMenu }
            );

            // Show Joiner (You) the menu
            const menu = myRole === 'spoonie' ? spoonieMenu : supporterMenu;
            return ctx.reply(`✨ Connected! You are now linked to *${inviter.firstName}*.\n\nHere are your controls:`, { parse_mode: 'Markdown', ...menu });
        }
    }

    // CASE C: New User (Initiator)
    ctx.reply(
        `Hi ${firstName}, welcome to Moonbeam. 🌙\n\nTo tailor the experience, please tell me: \nDo you live with ME/CFS, or are you the supporter?`,
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

async function sendInviteLink(ctx) {
    const userId = ctx.from.id.toString();
    const botUsername = ctx.botInfo.username;
    const link = `https://t.me/${botUsername}?start=${userId}`;

    // Get role to show the preview menu immediately
    const user = await getUser(userId);
    const menu = user.role === 'spoonie' ? spoonieMenu : supporterMenu;

    await ctx.editMessageText(
        `Got it! 🌙\n\nNow, send this Magic Link to your partner.\n` +
        `When they click it, you will be automatically connected.\n\n` +
        `🔗 ${link}`
    );

    ctx.reply("Here is your control panel (It will become active once they join):", menu);
}

// --- COMMUNICATION LOGIC ---

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

// --- SPOONIE ACTIONS (With Names) ---
bot.action('status_green', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🟢 *${name}'s Energy Update:* \nFeeling good! Ready to chat.`);
});

bot.action('status_yellow', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🟡 *${name}'s Energy Update:* \nResting. Low interaction only.`);
});

bot.action('status_red', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🔴 *${name}'s Energy Update:* \nIn a Crash/PEM. No screens. I will reach out when I can.`);
});

bot.action('mode_dark', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🌙 *${name} is in Dark Room Mode:* \nLight sensitive. Please send voice notes only.`);
});

// --- SUPPORTER ACTIONS (With Names) ---
bot.action('send_heart', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `❤️ *${name} is thinking of you.* (No reply needed)`);
});

bot.action('send_hug', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🫂 *${name} is sending a warm, gentle hug.*`);
});

bot.action('send_morning', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `☀️ *Good morning from ${name}.* I hope you rested well.`);
});

bot.action('send_night', (ctx) => {
    const name = ctx.from.first_name;
    notifyPartner(ctx, `🌙 *Good night from ${name}.* Sleep well and recharge.`);
});

// The "Smart Check-in"
bot.action('req_checkin', async (ctx) => {
    const userId = ctx.from.id.toString();
    const name = ctx.from.first_name;
    const user = await getUser(userId);

    if (!user || !user.partnerId) {
        return ctx.reply("⚠️ Not connected yet.");
    }

    ctx.answerCbQuery("Check-in sent! 🌙");

    bot.telegram.sendMessage(
        user.partnerId,
        `❓ *Gentle Check-in from ${name}:* \nHow is your energy envelope right now? \n(Tap below when you can)`,
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