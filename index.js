require('dotenv').config();
const {
    Telegraf,
    Markup
} = require('telegraf');
const Redis = require('ioredis');

// --- CONFIGURATION ---
const bot = new Telegraf(process.env.BOT_TOKEN);
const redis = new Redis(process.env.REDIS_URL);

// --- INSTRUCTION TEXTS ---
const spoonieGuide =
    `📖 *How to use your buttons:*\n\n` +
    `🟢 *Good Energy:* You are okay and up for chatting.\n` +
    `🟡 *Resting:* You are tired. Low interaction.\n` +
    `🔴 *Crash/PEM:* Need total rest. No screens.\n` +
    `🌙 *Dark Room:* Light-sensitive. Voice Notes only.\n` +
    `📝 *Send Note:* Type a custom message to your partner.`;

const supporterGuide =
    `📖 *How to use your buttons:*\n\n` +
    `❤️/🫂 *Send Love:* Support without pressure.\n` +
    `❓ *Check-in:* Gently asks for an energy update.\n` +
    `📝 *Send Note:* Type a custom positive message.\n\n` +
    `*Interpreting signals:*\n` +
    `🔴 = Crashing. Wait for them.\n` +
    `🌙 = Dark room. Use voice notes.`;

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
        const updated = {
            ...current,
            ...newData
        };
        await redis.set(`user:${id}`, JSON.stringify(updated));
    } catch (err) {
        console.error("Redis Save Error:", err);
    }
}

// --- MENUS ---

// Dynamic Spoonie Menu
const getSpoonieMenu = (activeStatus = null) => {
    return Markup.inlineKeyboard([
        [Markup.button.callback(activeStatus === 'status_green' ? '✅ 🟢 Good Energy' : '🟢 Good Energy', 'status_green')],
        [Markup.button.callback(activeStatus === 'status_yellow' ? '✅ 🟡 Resting / Low' : '🟡 Resting / Low', 'status_yellow')],
        [Markup.button.callback(activeStatus === 'status_red' ? '✅ 🔴 Crash / PEM' : '🔴 Crash / PEM', 'status_red')],
        [
            Markup.button.callback(activeStatus === 'mode_dark' ? '✅ 🌙 Dark Room' : '🌙 Dark Room', 'mode_dark'),
            Markup.button.callback('❤️ Send Heart', 'send_heart')
        ],
        [Markup.button.callback('📝 Send Positive Note', 'prompt_note')]
    ]);
};

// Static Supporter Menu
const supporterMenu = Markup.inlineKeyboard([
    [Markup.button.callback('❤️ Thinking of You', 'send_heart'), Markup.button.callback('🫂 Big Hug', 'send_hug')],
    [Markup.button.callback('☀️ Good Morning', 'send_morning'), Markup.button.callback('🌙 Good Night', 'send_night')],
    [Markup.button.callback('❓ Gentle Status Check', 'req_checkin')],
    [Markup.button.callback('📝 Send Positive Note', 'prompt_note')]
]);

// --- ONBOARDING FLOW ---
bot.start(async (ctx) => {
    const userId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || 'Partner';
    const payload = ctx.startPayload;

    await saveUser(userId, {
        firstName
    });
    const user = await getUser(userId);

    // CASE A: Already registered
    if (user && user.partnerId) {
        const menu = user.role === 'spoonie' ? getSpoonieMenu(user.currentStatus) : supporterMenu;
        return ctx.reply(`Welcome back, ${user.firstName}. 🌙`, menu);
    }

    // CASE B: Joining via Link
    if (payload && payload !== userId) {
        const inviter = await getUser(payload);
        if (inviter) {
            const myRole = (inviter.role === 'spoonie') ? 'supporter' : 'spoonie';

            await saveUser(userId, {
                role: myRole,
                partnerId: payload,
                firstName
            });
            await saveUser(payload, {
                partnerId: userId
            });

            // Notify Inviter
            const inviterMenu = (inviter.role === 'spoonie') ? getSpoonieMenu(inviter.currentStatus) : supporterMenu;
            const inviterGuide = (inviter.role === 'spoonie') ? spoonieGuide : supporterGuide;

            await bot.telegram.sendMessage(payload, `✨ *${firstName}* has connected!`, {
                parse_mode: 'Markdown'
            });
            await bot.telegram.sendMessage(payload, inviterGuide, {
                parse_mode: 'Markdown'
            });
            await bot.telegram.sendMessage(payload, "Here is your control panel:", inviterMenu);

            // Notify Joiner
            const myMenu = myRole === 'spoonie' ? getSpoonieMenu() : supporterMenu;
            const myGuide = myRole === 'spoonie' ? spoonieGuide : supporterGuide;

            await ctx.reply(`✨ Connected to *${inviter.firstName}*.`, {
                parse_mode: 'Markdown'
            });
            await ctx.reply(myGuide, {
                parse_mode: 'Markdown'
            });
            return ctx.reply("Here is your control panel:", myMenu);
        }
    }

    // CASE C: New User
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
    await saveUser(userId, {
        role: 'spoonie'
    });
    sendInviteLink(ctx);
});

bot.action('set_role_supporter', async (ctx) => {
    const userId = ctx.from.id.toString();
    await saveUser(userId, {
        role: 'supporter'
    });
    sendInviteLink(ctx);
});

async function sendInviteLink(ctx) {
    const userId = ctx.from.id.toString();
    const botUsername = ctx.botInfo.username;
    const link = `https://t.me/${botUsername}?start=${userId}`;
    await ctx.editMessageText(
        `Got it! 🌙\n\nNow, send this Magic Link to your partner.\n` +
        `When they click it, your menu will appear automatically.\n\n` +
        `🔗 ${link}`
    );
}

// --- COMMUNICATION LOGIC ---
const notifyPartner = async (ctx, message, extraOptions = {}) => {
    const userId = ctx.from.id.toString();
    const user = await getUser(userId);

    if (!user || !user.partnerId) {
        return ctx.reply("⚠️ You aren't connected yet. Type /start.");
    }

    bot.telegram.sendMessage(user.partnerId, message, {
            parse_mode: 'Markdown',
            ...extraOptions
        })
        .then(() => ctx.answerCbQuery("Sent! 🌙"))
        .catch((err) => {
            console.error(err);
            ctx.answerCbQuery("Error: Could not reach partner.");
        });
};

// --- DYNAMIC STATUS HANDLER ---
const handleStatusUpdate = async (ctx, statusKey, statusMessage) => {
    const userId = ctx.from.id.toString();

    // Save the new active status
    await saveUser(userId, {
        currentStatus: statusKey
    });

    // Update the visual menu to show the checkmark
    try {
        await ctx.editMessageReplyMarkup(getSpoonieMenu(statusKey).reply_markup);
    } catch (err) {
        // Telegram throws an error if we try to edit the menu with the exact same data.
        if (!err.description || !err.description.includes('message is not modified')) {
            console.error("Error editing menu:", err);
        }
    }

    // Send the notification
    await notifyPartner(ctx, statusMessage);
};

// --- STANDARD ACTIONS ---
bot.action('status_green', (ctx) => handleStatusUpdate(ctx, 'status_green', `🟢 *${ctx.from.first_name}'s Energy Update:* \nFeeling good! Ready to chat.`));
bot.action('status_yellow', (ctx) => handleStatusUpdate(ctx, 'status_yellow', `🟡 *${ctx.from.first_name}'s Energy Update:* \nResting. Low interaction only.`));
bot.action('status_red', (ctx) => handleStatusUpdate(ctx, 'status_red', `🔴 *${ctx.from.first_name}'s Energy Update:* \nIn a Crash/PEM. No screens. I will reach out when I can.`));
bot.action('mode_dark', (ctx) => handleStatusUpdate(ctx, 'mode_dark', `🌙 *${ctx.from.first_name} is in Dark Room Mode:* \nLight sensitive. Please send voice notes only.`));

bot.action('send_heart', (ctx) => notifyPartner(ctx, `❤️ *${ctx.from.first_name} is thinking of you.* (No reply needed)`));
bot.action('send_hug', (ctx) => notifyPartner(ctx, `🫂 *${ctx.from.first_name} is sending a warm, gentle hug.*`));
bot.action('send_morning', (ctx) => notifyPartner(ctx, `☀️ *Good morning from ${ctx.from.first_name}.* I hope you rested well.`));
bot.action('send_night', (ctx) => notifyPartner(ctx, `🌙 *Good night from ${ctx.from.first_name}.* Sleep well and recharge.`));

bot.action('req_checkin', async (ctx) => {
    const userId = ctx.from.id.toString();
    const name = ctx.from.first_name;
    const user = await getUser(userId);
    if (!user || !user.partnerId) return ctx.reply("⚠️ Not connected yet.");

    // Retrieve partner's current status so the check-in menu reflects it
    const spoonieUser = await getUser(user.partnerId);
    const activeStatus = spoonieUser ? spoonieUser.currentStatus : null;

    ctx.answerCbQuery("Check-in sent! 🌙");
    bot.telegram.sendMessage(
        user.partnerId,
        `❓ *Gentle Check-in from ${name}:* \nHow is your energy envelope right now? \n(Tap below when you can)`, {
            parse_mode: 'Markdown',
            ...getSpoonieMenu(activeStatus)
        }
    ).catch(err => console.log("Failed to reach partner", err));
});

// --- CUSTOM NOTE FEATURE ---
bot.action('prompt_note', async (ctx) => {
    const userId = ctx.from.id.toString();
    await redis.set(`chatState:${userId}`, 'waiting_for_note');

    ctx.reply("📝 Type your positive note now, and I will deliver it...");
    ctx.answerCbQuery();
});

bot.on('text', async (ctx) => {
    const userId = ctx.from.id.toString();
    const state = await redis.get(`chatState:${userId}`);

    if (state === 'waiting_for_note') {
        const user = await getUser(userId);
        const name = ctx.from.first_name;
        const noteText = ctx.message.text;

        if (user && user.partnerId) {
            await bot.telegram.sendMessage(
                user.partnerId,
                `💌 *New Note from ${name}:*\n\n"${noteText}"`, {
                    parse_mode: 'Markdown'
                }
            );

            await ctx.reply("✨ Note sent!");
            await redis.del(`chatState:${userId}`);
        } else {
            ctx.reply("⚠️ Error: Not connected to a partner.");
        }
    }
});

// --- STARTUP ---
bot.launch().then(() => {
    console.log("Moonbeam (Pro/Redis) is running...");
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));