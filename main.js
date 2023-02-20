const core = require('@actions/core')
const httpClient = require('@actions/http-client')

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/110.0'

function getTrackingUrl(id) {
  return `https://prodapi.pochta.uz/api/v1/public/order/${id}/history_items`
}

function getTelegramUrl(token) {
  return `https://api.telegram.org/bot${token}/sendMessage`
}

const options = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
}

async function run() {
  try {
    const jsonData = core.getInput('data')
    const lastXItems = parseInt(core.getInput('last_x_items'))
    const telegramToken = core.getInput('telegram_token')
    const chatId = core.getInput('telegram_id')
    const data = JSON.parse(jsonData)
    const promises = []
    const results = []

    if (Number.isNaN(lastXItems)) {
      core.setFailed('last_x_items must be a numeric value')
      process.exit(1)
    }

    const client = new httpClient.HttpClient(USER_AGENT)

    for (const trackingId of data) {
      const url = getTrackingUrl(trackingId)
      promises.push(client.get(url))
    }

    const responses = await Promise.allSettled(promises)

    for (let i = 0; i < responses.length; i++) {
      const response = responses[i]
      if (response.status === 'fulfilled') {
        results.push({
          id: data[i],
          value: response.value.readBody(),
        })
      } else {
        core.info(response.reason)
      }
    }

    const jsonResults = await Promise.allSettled(
      results.map((result) => result.value)
    )

    for (let i = 0; i < results.length; i++) {
      const id = results[i].id
      const result = jsonResults[i]

      if (result.status === 'fulfilled') {
        const messages = [
          `🚚 <b>Parcel tracking history</b>: <code>${id}</code>`,
        ]
        const json = JSON.parse(result.value)
        if (json.status === 'error') {
          messages.push(`❌ ${json.message}`)
        } else if (
          json.status === 'success' &&
          json.data &&
          json.data.total > 0
        ) {
          const upTo = lastXItems !== -1 ? lastXItems : json.data.total

          for (let i = 0; i < upTo; i++) {
            const element = json.data.list[i]
            const desc = element.status_desc
            const date = new Date(element.date).toLocaleString('en-US', options)
            const warehouseName = element.warehouse.name
            let message = `📅 ${date}\n🚧 ${desc}\n🏪 ${warehouseName}`

            if (element.batch) {
              message += `\nℹ️ <b>${element.batch.type}</b> (<code>${element.batch.code}</code>)`
            }

            messages.push(message)
          }
        }

        client
          .postJson(getTelegramUrl(telegramToken), {
            chat_id: chatId,
            text: messages.join('\n\n'),
            parse_mode: 'HTML',
          })
          .catch((error) => {
            core.setFailed(error)
            process.exit(1)
          })
      } else {
        core.info(result.reason)
      }
    }

    core.setOutput('done', 'true')
  } catch (error) {
    core.setFailed(error)
  }
}

run()
