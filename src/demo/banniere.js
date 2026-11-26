'use strict'

// Bannière de démarrage du mode démo : adresses à saisir dans l'application
// mobile (même réseau Wi-Fi que l'ordinateur) et comptes fictifs.

const os = require('os')
const { COMPTES_DEMO } = require('./donneesDemo')

// Adresses IPv4 du réseau local, Wi-Fi en premier (les cartes virtuelles
// WSL / Hyper-V / VirtualBox ne sont pas joignables depuis un téléphone).
const adressesReseauLocal = () => Object.entries(os.networkInterfaces())
  .flatMap(([nom, adresses]) => (adresses || [])
    .filter((adresse) => adresse.family === 'IPv4' && !adresse.internal)
    .map((adresse) => ({ nom, adresse: adresse.address })))
  .sort((a, b) => Number(/wi-?fi|wlan/i.test(b.nom)) - Number(/wi-?fi|wlan/i.test(a.nom)))

const banniereDemo = (port) => {
  const trait = '═'.repeat(66)
  const lignes = [
    trait,
    '  SMART ROAM — MODE DÉMO (données fictives, aucune base réelle)',
    trait,
    `  API locale       http://localhost:${port}`,
    ...adressesReseauLocal().map(({ nom, adresse }) => `  Réseau local     http://${adresse}:${port}   (${nom})`),
    '  → dans l\'application mobile, saisir l\'adresse du réseau Wi-Fi partagé avec le téléphone',
    '',
    '  Comptes de démonstration :',
    ...COMPTES_DEMO.map((compte) => `    ${compte.nom.padEnd(24)} ${compte.telephone.padEnd(15)} PIN ${compte.pin}${compte.role === 'ADMIN' ? '  (administrateur)' : ''}`),
    '',
    `  Scénario commenté   npm run demo -- --url http://localhost:${port}`,
    '  Réinitialiser       POST /api/demo/reinitialiser',
    trait
  ]
  return `${lignes.join('\n')}\n`
}

module.exports = { banniereDemo, adressesReseauLocal }
