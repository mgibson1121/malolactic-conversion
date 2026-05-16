import { google } from 'googleapis'
import path from 'path'

export function createSheetsClient() {
  const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS
  if (!credentialsPath) {
    throw new Error(
      'GOOGLE_SHEETS_CREDENTIALS is not set. ' +
        'Set it to the absolute path of your service account JSON file.'
    )
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: path.resolve(credentialsPath),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })

  return google.sheets({ version: 'v4', auth })
}
