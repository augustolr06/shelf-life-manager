/**
 * Gera um par de chaves VAPID: `npm run push:chaves`.
 *
 * Roda uma vez por instalação. O par é a identidade deste servidor perante o
 * serviço de push do navegador — trocá-lo depois **invalida todas as inscrições
 * existentes**, e cada aparelho precisa se inscrever de novo.
 *
 * O script só imprime: quem grava no `.env` é quem instala. Escrever no arquivo
 * por conta própria sobrescreveria configuração de produção sem aviso.
 */
import webpush from 'web-push'

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log('Cole no backend/.env (a chave privada nunca sai do servidor):\n')
console.log(`VAPID_PUBLIC_KEY="${publicKey}"`)
console.log(`VAPID_PRIVATE_KEY="${privateKey}"`)
console.log('VAPID_SUBJECT="mailto:seu-contato@exemplo.com"')
