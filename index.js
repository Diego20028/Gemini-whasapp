import baileys, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import OpenAI from 'openai';
import express from 'express';
import pino from 'pino';
import fs from 'fs';

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

// 2. Cliente OpenAI hacia tu Proxy LiteLLM
const openai = new OpenAI({
  baseURL: process.env.LITELLM_URL,
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

// 3. Conexión a WhatsApp con manejo de credenciales
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['Ubuntu', 'Chrome', '20.0.04']
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
      console.log('\n==================================================');
      console.log('ABRE ESTE LINK EN EL NAVEGADOR PARA ESCANEAR EL QR:');
      console.log(qrImageUrl);
      console.log('==================================================\n');
    }

    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      // Si la sesión falló al autenticar o se desvinculó, limpiamos la carpeta corrupta
      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        console.log('[WhatsApp] Sesión inválida. Limpiando archivos de autenticación...');
        if (fs.existsSync('auth_info_baileys')) {
          fs.rmSync('auth_info_baileys', { recursive: true, force: true });
        }
      }

      console.log('[WhatsApp] Conexión cerrada. Reconectando:', shouldReconnect);
      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 3000); // Espera 3 segundos antes de reintentar
      }
    } else if (connection === 'open') {
      console.log('[WhatsApp] ¡Bot conectado exitosamente!');
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
      
