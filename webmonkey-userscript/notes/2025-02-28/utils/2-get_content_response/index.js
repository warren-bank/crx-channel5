if (process.argv.length < 4) {
  console.log('usage: node index.js <content_id> <is_live_channel> [<debug>]')
  process.exit(1)
}

const config = require('./config.json')
const keys = require('./keys.json')
const content_id = process.argv[2]
const is_live_channel = (process.argv[3] === '1')
const debug = (process.argv.length >= 5) ? parseInt(process.argv[4], 10) : 0

// isomorphic library
// https://cryptojs.gitbook.io/docs#hmac
// https://cdnjs.cloudflare.com/ajax/libs/crypto-js/4.2.0/crypto-js.min.js
const CryptoJS = require('./js/crypto-js.min.js')

// isomorphic library
// https://github.com/ricmoo/aes-js
// https://cdn.jsdelivr.net/gh/ricmoo/aes-js@3.1.2/index.js
const aesjs = require('./js/aes-js.js')

const b64_std_to_url = (b64) => b64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const b64_url_to_std = (b64) => b64.replace(/\u002d/g, '+').replace(/\x5f/g, '/')
const get_bytes = (b64) => aesjs.utils.hex.toBytes(
  CryptoJS.enc.Hex.stringify(
    CryptoJS.enc.Base64.parse(b64)
  )
)

const generate_content_url = (content_id) => {
  const timestamp = Math.floor(Date.now() / 1000)
  const c_url = `${ is_live_channel ? config.BASE_URL_LIVE_MEDIA : config.BASE_URL_MEDIA }/${config.APP_NAME}/${content_id}.json?timestamp=${timestamp}`
  const sig = CryptoJS.HmacSHA256(c_url, CryptoJS.enc.Base64.parse(keys.HMAC_SECRET))
  const auth = b64_std_to_url( sig.toString(CryptoJS.enc.Base64) )

  return `${c_url}&auth=${auth}`
}

const get_content_response = (content_url) => {
  return fetch(content_url, {headers: config.DEFAULT_JSON_HEADERS})
    .then(res => res.json())
    .then(decrypt_content)
}

const decrypt_content = (content) => {
  if (debug === 2) {return content}

  content.iv   = b64_url_to_std(content.iv)
  content.data = b64_url_to_std(content.data)

  if (debug === 3) {return content}

  const key_bytes  = get_bytes(keys.AES_KEY)
  const iv_bytes   = get_bytes(content.iv)
  const data_bytes = get_bytes(content.data)

  const aesCbc = new aesjs.ModeOfOperation.cbc(key_bytes, iv_bytes)
  const decryptedBytes = aesCbc.decrypt(data_bytes, false)
  const strippedBytes = aesjs.padding.pkcs7.strip(decryptedBytes)

  const decryptedJson    = aesjs.utils.utf8.fromBytes(strippedBytes)
  const decryptedContent = JSON.parse(decryptedJson)

  return decryptedContent
}

const init = async () => {
  const content_url = generate_content_url(content_id)
  if (debug === 1) {return console.log('content_url:', content_url)}

  const content_response = await get_content_response(content_url)
  if (debug === 2) {return console.log('encrypted content_response:', JSON.stringify(content_response, null, 2))}
  if (debug === 3) {return console.log('encrypted content_response:', JSON.stringify(content_response, null, 2))}
  if (debug === 4) {return console.log('decrypted content_response:', JSON.stringify(content_response, null, 2))}

  console.log(content_response)
}

init()
