// TEMPORARY: renames the bot to Kirti through the Bot API with the server's token; delete after one call
const { callApi } = require('../lib/telegram');

const APP_URL = 'https://danielkrinets.github.io/recipe-book/';
const TEXTS = {
  ru: {
    short: 'Kirti: ваша книга рецептов. Пришлите ссылку, видео или фото, и рецепт сохранится сам.',
    long: 'Kirti собирает рецепты в одну книгу. Пришлите ссылку на YouTube, TikTok, Instagram или сайт, фото или видео: ИИ разберёт ингредиенты и шаги, а вы сохраните рецепт. Все рецепты открываются в приложении Kirti.',
  },
  en: {
    short: 'Kirti: your recipe book. Send a link, video or photo and the recipe saves itself.',
    long: 'Kirti keeps your recipes in one book. Send a YouTube, TikTok, Instagram or website link, a photo or a video: AI picks out the ingredients and steps, and you save the recipe. All recipes open in the Kirti app.',
  },
  he: {
    short: 'Kirti: ספר המתכונים שלכם. שלחו קישור, סרטון או תמונה והמתכון יישמר.',
    long: 'Kirti אוסף את המתכונים לספר אחד. שלחו קישור מ-YouTube, TikTok, Instagram או מאתר, תמונה או סרטון: ה-AI יזהה את המצרכים והשלבים, ואתם תשמרו את המתכון. כל המתכונים נפתחים באפליקציית Kirti.',
  },
};

module.exports = async (req, res) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const done = [];
  const run = async (label, method, body) => {
    try { await callApi(token, method, body); done.push(`${label}: ok`); } catch (err) { done.push(`${label}: ${err.message}`); }
  };
  await run('name', 'setMyName', { name: 'Kirti' });
  await run('short', 'setMyShortDescription', { short_description: TEXTS.en.short });
  await run('long', 'setMyDescription', { description: TEXTS.en.long });
  for (const [lang, t] of Object.entries(TEXTS)) {
    await run(`name ${lang}`, 'setMyName', { name: 'Kirti', language_code: lang });
    await run(`short ${lang}`, 'setMyShortDescription', { short_description: t.short, language_code: lang });
    await run(`long ${lang}`, 'setMyDescription', { description: t.long, language_code: lang });
  }
  await run('menu', 'setChatMenuButton', { menu_button: { type: 'web_app', text: 'Kirti', web_app: { url: APP_URL } } });
  res.json({ done });
};
