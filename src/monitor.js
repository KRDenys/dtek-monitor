import { chromium } from "playwright"

import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  CITY,
  STREET,
  HOUSE,
  SHUTDOWNS_PAGE,
} from "./constants.js"

import {
  capitalize,
  deleteLastMessage,
  getCurrentTime,
  loadLastMessage,
  saveLastMessage,
} from "./helpers.js"

// =====================
// Отримання інформації
// =====================
async function getInfo() {
  console.log("🌀 Getting info...")

  const browser = await chromium.launch({ headless: true })
  const browserPage = await browser.newPage()

  try {
    await browserPage.goto(SHUTDOWNS_PAGE, {
      waitUntil: "load",
    })

    const csrfTokenTag = await browserPage.waitForSelector(
      'meta[name="csrf-token"]',
      { state: "attached" }
    )
    const csrfToken = await csrfTokenTag.getAttribute("content")

    const info = await browserPage.evaluate(
      async ({ CITY, STREET, csrfToken }) => {
        const formData = new URLSearchParams()
        formData.append("method", "getHomeNum")
        formData.append("data[0][name]", "city")
        formData.append("data[0][value]", CITY)
        formData.append("data[1][name]", "street")
        formData.append("data[1][value]", STREET)
        formData.append("data[2][name]", "updateFact")
        formData.append("data[2][value]", new Date().toLocaleString("uk-UA"))

        const response = await fetch("/ua/ajax", {
          method: "POST",
          headers: {
            "x-requested-with": "XMLHttpRequest",
            "x-csrf-token": csrfToken,
          },
          body: formData,
        })
        return await response.json()
      },
      { CITY, STREET, csrfToken }
    )

    console.log("✅ Getting info finished.")
    return info
  } catch (error) {
    throw Error(`❌ Getting info failed: ${error.message}`)
  } finally {
    await browser.close()
  }
}

// =====================
// Перевірки
// =====================
function checkIsOutage(info) {
  console.log("🌀 Checking power outage...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const { sub_type, start_date, end_date, type } = info?.data?.[HOUSE] || {}
  const isOutageDetected =
    sub_type !== "" || start_date !== "" || end_date !== "" || type !== ""

  isOutageDetected
    ? console.log("🚨 Power outage detected!")
    : console.log("⚡️ No power outage!")

  return isOutageDetected
}

function checkIsScheduled(info) {
  console.log("🌀 Checking whether power outage scheduled...")

  if (!info?.data) {
    throw Error("❌ Power outage info missed.")
  }

  const { sub_type = "" } = info?.data?.[HOUSE] || {}
  const lower = sub_type.toLowerCase()

  const isScheduled =
    !lower.includes("авар") && !lower.includes("екст")

  isScheduled
    ? console.log("🗓️ Power outage scheduled!")
    : console.log("⚠️ Power outage NOT scheduled!")

  return isScheduled
}

// =====================
// Генерація повідомлення
// =====================
function generateMessage(info, isScheduled) {
  console.log("🌀 Generating message...")

  const { sub_type, start_date, end_date } = info?.data?.[HOUSE] || {}
  const { updateTimestamp } = info || {}

  const reason = capitalize(sub_type || "Невідома причина")
  const begin = start_date?.split(" ")[0] || "—"
  const end = end_date?.split(" ")[0] || "—"

  const statusLine = isScheduled
    ? "🗓️ <b>Планове відключення</b>"
    : "🚨 <b>Аварійне відключення</b>"

  return [
    "⚡️ <b>Зафіксовано відключення:</b>",
    statusLine,
    `🪫 <code>${begin} — ${end}</code>`,
    "",
    `⚠️ <i>${reason}.</i>`,
    "\n",
    `🔄 <i>${updateTimestamp || "—"}</i>`,
    `💬 <i>${getCurrentTime()}</i>`,
  ].join("\n")
}

// =====================
// Відправка в Telegram
// =====================
async function sendNotification(message) {
  if (!TELEGRAM_BOT_TOKEN)
    throw Error("❌ Missing telegram bot token.")
  if (!TELEGRAM_CHAT_ID)
    throw Error("❌ Missing telegram chat id.")

  console.log("🌀 Sending notification...")

  const lastMessage = loadLastMessage() || {}

  const send = async (method) => {
    const response = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: message,
          parse_mode: "HTML",
          message_id: lastMessage.message_id ?? undefined,
        }),
      }
    )

    return await response.json()
  }

  try {
    let data

    if (lastMessage.message_id) {
      console.log("✏️ Trying to update last message...")
      data = await send("editMessageText")

      if (!data.ok) {
        console.log("↩️ Update failed, sending new message...")
        deleteLastMessage()
        data = await send("sendMessage")
      }
    } else {
      data = await send("sendMessage")
    }

    if (data.ok && data.result) {
      saveLastMessage(data.result)
      console.log("🟢 Notification sent.")
    } else {
      throw new Error(JSON.stringify(data))
    }
  } catch (error) {
    console.log("🔴 Notification not sent.", error.message)
    deleteLastMessage()
  }
}

// =====================
// Головний запуск
// =====================
async function run() {
  const info = await getInfo()

  const isOutage = checkIsOutage(info)
  if (!isOutage) return

  const isScheduled = checkIsScheduled(info)

  const message = generateMessage(info, isScheduled)
  await sendNotification(message)
}

run().catch((error) => console.error(error.message))
