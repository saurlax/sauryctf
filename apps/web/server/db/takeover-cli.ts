import { parseDataServicesConfig } from '../infrastructure/config/data-services'
import { createPostgresTakeoverDatabase } from './takeover-postgres'
import { takeOverLegacyDrizzleJournal } from './takeover'

const config = parseDataServicesConfig(process.env)
const database = createPostgresTakeoverDatabase(config.database.url)

try {
  const result = await takeOverLegacyDrizzleJournal(database)
  console.log(`NuxtHub migration journal takeover: ${result.state} (${result.migrations} migrations).`)
}
finally {
  await database.close()
}
