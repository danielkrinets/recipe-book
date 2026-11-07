const API = 'https://api.telegram.org';

// The token sits in the URL path, so errors report only the method and status code
async function callApi(token, method, body, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`telegram ${method} ${res.status}`);
  return (await res.json()).result;
}

const sendMessage = (token, chatId, text, replyMarkup, fetchImpl) =>
  callApi(token, 'sendMessage', { chat_id: chatId, text, reply_markup: replyMarkup }, fetchImpl);

const answerCallbackQuery = (token, callbackQueryId, text, fetchImpl) =>
  callApi(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text }, fetchImpl);

const getFile = (token, fileId, fetchImpl) => callApi(token, 'getFile', { file_id: fileId }, fetchImpl);

async function downloadFile(token, filePath, fetchImpl = fetch) {
  const res = await fetchImpl(`${API}/file/bot${token}/${filePath}`);
  if (!res.ok) throw new Error(`telegram file ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

module.exports = { sendMessage, answerCallbackQuery, getFile, downloadFile };
