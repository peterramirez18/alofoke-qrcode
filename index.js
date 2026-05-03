require("dotenv").config();
const express = require("express");

const TelegramBot = require("node-telegram-bot-api");
const QRCode = require("qrcode");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const bot = new TelegramBot(process.env.BOT_TOKEN, {
  polling: true,
});

const app = express();
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
  res.send("Telegram QR Bot funcionando ✅");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});

function isValidUrl(text) {
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

function parseMessage(messageText) {
  const [linkPart, ...textParts] = messageText.split(",");

  const link = linkPart?.trim();
  const label = textParts.join(",").trim();

  return {
    link,
    label: label || link,
  };
}

function fileToDataUrl(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  let mimeType = "image/png";
  if (ext === ".jpg" || ext === ".jpeg") mimeType = "image/jpeg";
  if (ext === ".webp") mimeType = "image/webp";
  if (ext === ".svg") mimeType = "image/svg+xml";

  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString("base64");

  return `data:${mimeType};base64,${base64}`;
}

function createHtml({ label, qrBase64, logoDataUrl }) {
  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <style>
      * {
        box-sizing: border-box;
      }

      html,
      body {
        margin: 0;
        padding: 0;
        background: transparent;
        width: fit-content;
        height: fit-content;
        font-family: Arial, sans-serif;
      }

      body {
        display: inline-block;
      }

      .qr-box {
        background: black;
        padding: 32px;
        border-radius: 16px;
        display: inline-block;
      }

      .qr-wrapper {
        position: relative;
        width: 420px;
        height: 420px;
      }

      .qr-image {
  width: 420px;
  height: 420px;
  display: block;
  image-rendering: crisp-edges;
}

      .logo-badge {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 184px;
  height: 184px;
  border-radius: 20px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
filter:
  drop-shadow(-1px 4px 24px rgba(0, 0, 0, 1))
  drop-shadow(-1px 4px 32px rgba(0, 0, 0, 1))
  drop-shadow(-1px 4px 48px rgba(0, 0, 0, 1))
    drop-shadow(-1px 4px 48px rgba(0, 0, 0, 1))
      drop-shadow(-1px 4px 48px rgba(0, 0, 0, 1))
}

      .logo-badge img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}

      .text {
        width: 420px;
        font-size: 34px;
        opacity: 0.95;
        word-break: break-word;
        overflow-wrap: break-word;
        font-weight: bold;
        text-align: center;
        margin-top: 30px;
        color: white;
        line-height: 1.2;
      }
    </style>
  </head>

  <body>
    <div class="qr-box">
      <div class="qr-wrapper">
        <img class="qr-image" src="${qrBase64}" />
        ${
          logoDataUrl
            ? `
          <div class="logo-badge">
            <img src="${logoDataUrl}" />
          </div>
        `
            : ""
        }
      </div>
      <div class="text">${label}</div>
    </div>
  </body>
</html>
  `;
}

async function htmlToImage(html, outputPath) {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 180000,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-software-rasterizer",
      ],
    });

    const page = await browser.newPage();

    await page.setViewport({
      width: 800,
      height: 800,
      deviceScaleFactor: 2,
    });

    await page.setContent(html, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    await page.waitForSelector(".qr-box", {
      visible: true,
      timeout: 10000,
    });

    const element = await page.$(".qr-box");

    if (!element) {
      throw new Error("No se encontró el elemento .qr-box para exportar.");
    }

    await element.evaluate((el) => {
      el.scrollIntoView({
        block: "center",
        inline: "center",
      });
    });

    const box = await element.boundingBox();

    if (!box) {
      throw new Error("No se pudo calcular el tamaño del elemento .qr-box.");
    }

    await page.screenshot({
      path: outputPath,
      type: "png",
      clip: {
        x: Math.max(0, Math.floor(box.x)),
        y: Math.max(0, Math.floor(box.y)),
        width: Math.ceil(box.width),
        height: Math.ceil(box.height),
      },
      omitBackground: true,
    });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text?.trim();

  if (!messageText) return;

  if (messageText === "/start") {
    return bot.sendMessage(
      chatId,
      `Envíame un mensaje con este formato:

https://www.instagram.com/peter.ramirez18/, @peter.ramirez18

El QR se generará con el link, y el texto debajo será "@peter.ramirez18".`
    );
  }

  const { link, label } = parseMessage(messageText);

  if (!isValidUrl(link)) {
    return bot.sendMessage(
      chatId,
      `Formato inválido.

Envíame el mensaje así:

https://www.instagram.com/peter.ramirez18/, @peter.ramirez18`
    );
  }

  try {
    await bot.sendMessage(chatId, "Generando QR...");

    const qrBase64 = await QRCode.toDataURL(link, {
      width: 1200,
      margin: 1,
      errorCorrectionLevel: "H",
      color: {
        dark: "#e7000b",
        light: "#000000",
      },
    });

    // Ruta del logo PNG
    const logoPath = path.join(__dirname, "assets", "logo.png");

    // Si existe el logo, lo convertimos a data URL
    let logoDataUrl = null;
    if (fs.existsSync(logoPath)) {
      logoDataUrl = fileToDataUrl(logoPath);
    }

    const html = createHtml({
      label,
      qrBase64,
      logoDataUrl,
    });

    const outputPath = path.join(__dirname, `qr-${Date.now()}.png`);

    await htmlToImage(html, outputPath);

    await bot.sendPhoto(chatId, fs.createReadStream(outputPath), {
      caption: "Aquí tienes tu QR personalizado.",
    });

    fs.unlinkSync(outputPath);
  } catch (error) {
    console.error("ERROR COMPLETO:", error);

    await bot.sendMessage(
      chatId,
      `Ocurrió un error generando la imagen del QR:

${error.message}`
    );
  }
});