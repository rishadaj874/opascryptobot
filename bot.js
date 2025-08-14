require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('❌ BOT_TOKEN not found in .env');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// In-memory warning system
const warnings = {};
// Bad words list
const badWords = ['badword1', 'badword2', 'badword3'];

// Helper functions
const isAdmin = async (chatId, userId) => {
    const member = await bot.getChatMember(chatId, userId);
    return ['administrator', 'creator'].includes(member.status);
};

const addWarning = (userId) => {
    warnings[userId] = (warnings[userId] || 0) + 1;
    return warnings[userId];
};

const resetWarning = (userId) => {
    warnings[userId] = 0;
};

// =============== DM START HANDLER =================
bot.onText(/^\/start/, (msg) => {
    if (msg.chat.type === 'private') {
        bot.sendMessage(msg.chat.id, `👋 Hello ${msg.from.first_name}, I am OpasCrypto Bot!\n\n` +
            `I can help you manage your groups with kick, ban, mute, warn and more.\n` +
            `\nUse the menu below to learn more.`, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "📜 Help", callback_data: "help" }],
                    [{ text: "➕ Add me to a Group", url: `https://t.me/${process.env.BOT_USERNAME}?startgroup=true` }]
                ]
            }
        });
    }
});

// Inline help menu
bot.on('callback_query', (query) => {
    if (query.data === 'help') {
        bot.sendMessage(query.message.chat.id,
            `📖 *OpasCrypto Bot Commands*\n\n` +
            `/kick - Kick a user (reply)\n` +
            `/ban - Ban a user (reply)\n` +
            `/mute - Mute a user (reply)\n` +
            `/unmute - Unmute a user (reply)\n` +
            `/warn - Warn a user (reply)\n` +
            `/resetwarn - Reset warnings (reply)\n` +
            `\n*Admin only commands*`, { parse_mode: "Markdown" });
    }
});

// =============== GROUP WELCOME / GOODBYE ===============
bot.on('new_chat_members', (msg) => {
    msg.new_chat_members.forEach(member => {
        bot.sendMessage(msg.chat.id, `👋 Welcome, ${member.first_name}!`);
    });
});

bot.on('left_chat_member', (msg) => {
    bot.sendMessage(msg.chat.id, `👋 Goodbye, ${msg.left_chat_member.first_name}!`);
});

// =============== MESSAGE HANDLER ===============
bot.on('message', async (msg) => {
    if (!msg.text) return;

    // Ignore messages from private chats here
    if (msg.chat.type === 'private') return;

    const text = msg.text.toLowerCase();

    // Bad word filter
    if (badWords.some(word => text.includes(word))) {
        await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        return;
    }

    // Command handling
    const isAdminUser = await isAdmin(msg.chat.id, msg.from.id).catch(() => false);

    // Kick
    if (text.startsWith('/kick') && msg.reply_to_message && isAdminUser) {
        const userId = msg.reply_to_message.from.id;
        await bot.kickChatMember(msg.chat.id, userId);
        bot.sendMessage(msg.chat.id, `🚫 User ${msg.reply_to_message.from.first_name} was kicked.`);
    }

    // Ban
    if (text.startsWith('/ban') && msg.reply_to_message && isAdminUser) {
        const userId = msg.reply_to_message.from.id;
        await bot.banChatMember(msg.chat.id, userId);
        bot.sendMessage(msg.chat.id, `⛔ User ${msg.reply_to_message.from.first_name} was banned.`);
    }

    // Mute
    if (text.startsWith('/mute') && msg.reply_to_message && isAdminUser) {
        const userId = msg.reply_to_message.from.id;
        await bot.restrictChatMember(msg.chat.id, userId, { permissions: { can_send_messages: false } });
        bot.sendMessage(msg.chat.id, `🔇 User ${msg.reply_to_message.from.first_name} was muted.`);
    }

    // Unmute
    if (text.startsWith('/unmute') && msg.reply_to_message && isAdminUser) {
        const userId = msg.reply_to_message.from.id;
        await bot.restrictChatMember(msg.chat.id, userId, {
            permissions: {
                can_send_messages: true,
                can_send_media_messages: true,
                can_send_polls: true,
                can_send_other_messages: true,
                can_add_web_page_previews: true,
                can_change_info: true,
                can_invite_users: true,
                can_pin_messages: true
            }
        });
        bot.sendMessage(msg.chat.id, `🔊 User ${msg.reply_to_message.from.first_name} was unmuted.`);
    }

    // Warn
    if (text.startsWith('/warn') && msg.reply_to_message && isAdminUser) {
        const userId = msg.reply_to_message.from.id;
        const count = addWarning(userId);
        bot.sendMessage(msg.chat.id, `⚠️ User ${msg.reply_to_message.from.first_name} warned. Total warnings: ${count}`);
        if (count >= 3) {
            await bot.kickChatMember(msg.chat.id, userId);
            bot.sendMessage(msg.chat.id, `🚫 User ${msg.reply_to_message.from.first_name} kicked due to too many warnings.`);
            resetWarning(userId);
        }
    }

    // Reset warnings
    if (text.startsWith('/resetwarn') && msg.reply_to_message && isAdminUser) {
        resetWarning(msg.reply_to_message.from.id);
        bot.sendMessage(msg.chat.id, `✅ Warnings reset for ${msg.reply_to_message.from.first_name}.`);
    }
});

console.log('🤖 OpasCrypto Bot is running...');
