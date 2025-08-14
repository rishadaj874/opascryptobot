require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;

if (!token) {
    console.error('❌ BOT_TOKEN not found in .env file');
    process.exit(1);
}

// List of bad words (lowercase)
const badWords = ['badword1', 'badword2', 'badword3'];

// Create bot with polling
const bot = new TelegramBot(token, { polling: true });

// Welcome message
bot.on('new_chat_members', (msg) => {
    msg.new_chat_members.forEach(member => {
        bot.sendMessage(
            msg.chat.id,
            `👋 Welcome, ${member.first_name}!`
        );
    });
});

// Goodbye message
bot.on('left_chat_member', (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `👋 Goodbye, ${msg.left_chat_member.first_name}!`
    );
});

// Message handling
bot.on('message', async (msg) => {
    if (!msg.text) return;

    const text = msg.text.toLowerCase();

    // Auto-delete bad words
    if (badWords.some(word => text.includes(word))) {
        await bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => {});
        return;
    }

    // Kick command — must reply & from admin
    if (msg.text.startsWith('/kick') && msg.reply_to_message) {
        try {
            const chatMember = await bot.getChatMember(msg.chat.id, msg.from.id);

            if (['administrator', 'creator'].includes(chatMember.status)) {
                const userId = msg.reply_to_message.from.id;
                await bot.kickChatMember(msg.chat.id, userId);
                bot.sendMessage(msg.chat.id, `🚫 User ${msg.reply_to_message.from.first_name} was kicked.`);
            } else {
                bot.sendMessage(msg.chat.id, '❌ You are not an admin!');
            }
        } catch (err) {
            console.error(err);
        }
    }

    // Wanted command — DM sender
    if (msg.text.startsWith('/wanted')) {
        const args = msg.text.split(' ').slice(1).join(' ');
        if (!args) {
            bot.sendMessage(msg.chat.id, 'Usage: /wanted <username or message>');
            return;
        }

        bot.sendMessage(msg.from.id, `📢 Wanted notice: ${args}`).catch(() => {
            bot.sendMessage(msg.chat.id, '⚠️ Cannot DM you. Please start the bot in private first.');
        });
    }
});

console.log('🤖 Bot is running...');
