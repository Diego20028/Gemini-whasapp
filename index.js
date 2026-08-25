import baileys, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import OpenAI from 'openai';
import qrcode from 'qrcode-terminal';
import express from 'express';
import pino from 'pino';

// Resolver la función correctamente
const makeWASocket = baileys.default || baileys;

// 1. Servidor Express para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot de WhatsApp vía LiteLLM está activo.');
});

app.listen(PORT, () => {
  console.log(`[HTTP] Servidor escuchando en el puerto ${PORT}`);
});

// 2. Inicializar cliente OpenAI apuntando a tu LiteLLM Proxy
const openai = new OpenAI({
  baseURL: process.env.LITELLM_URL, // Ej: https://tu-proxy-litellm.onrender.com/v1
  apiKey: process.env.LITELLM_MASTER_KEY || 'sk-1234'
});

const TARGET_MODEL = 'gemini-3.6-flash';

async function generateGeminiResponse(prompt) {
  try {
    const response = await openai.chat.completions.create({
      model: TARGET_MODEL,
      messages: [{ role: 'user', content: prompt }],
    });
    return response.choices[0]?.message?.content || 'Sin respuesta.';
  } catch (error) {
    console.error('[LiteLLM Error]:', error);
    return 'Lo siento, ocurrió un error procesando tu mensaje.';
  }
}

// 3. Conexión de WhatsApp con Baileys
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('\n--- ESCANEA ESTE CÓDIGO QR EN WHATSAPP ---');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('[WhatsApp] Conexión cerrada. Reconectando:', shouldReconnect);
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === 'open') {
      console.log('[WhatsApp] Bot conectado exitosamente.');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
      if (!text) continue;

      const remoteJid = msg.key.remoteJid;
      const replyText = await generateGeminiResponse(text);
      await sock.sendMessage(remoteJid, { text: replyText }, { quoted: msg });
    }
  });
}

connectToWhatsApp();
                           
