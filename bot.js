const { Telegraf } = require('telegraf');

// Load bot token from environment variable
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN is missing. Set it in your environment variables.");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ✅ Bad words list (You can add more later)
const badWords = ['badword', 'stupid', 'idiot'];

// ✅ Welcome message
bot.on('new_chat_members', (ctx) => {
    ctx.message.new_chat_members.forEach((member) => {
        ctx.reply(`👋 Welcome, ${member.first_name}!`);
    });
});

// ✅ Goodbye message
bot.on('left_chat_member', (ctx) => {
    const member = ctx.message.left_chat_member;
    ctx.reply(`👋 Goodbye, ${member.first_name}.`);
});

// ✅ Auto-delete bad words
bot.on('text', async (ctx) => {
    const text = ctx.message.text.toLowerCase();
    if (badWords.some(word => text.includes(word))) {
        try {
            await ctx.deleteMessage();
            console.log(`🗑 Deleted a message with bad words: ${ctx.message.text}`);
        } catch (err) {
            console.error('Failed to delete message:', err.message);
        }
    }
});

// ✅ Kick user if admin replies with /kick
bot.command('kick', async (ctx) => {
    if (!ctx.message.reply_to_message) {
        return ctx.reply('❗ Reply to the user’s message you want to kick.');
    }

    const userIdToKick = ctx.message.reply_to_message.from.id;

    try {
        const member = await ctx.getChatMember(ctx.from.id);
        if (member.status === 'administrator' || member.status === 'creator') {
            await ctx.kickChatMember(userIdToKick);
            await ctx.reply(`✅ User has been kicked.`);
        } else {
            ctx.reply('❌ Only admins can use this command.');
        }
    } catch (err) {
        console.error('Kick error:', err.message);
        ctx.reply('⚠️ Failed to kick the user.');
    }
});

// ✅ Start bot
bot.launch()
    .then(() => console.log('🤖 Bot is running...'))
    .catch(err => console.error('Failed to start bot:', err.message));
