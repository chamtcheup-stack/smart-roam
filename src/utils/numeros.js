'use strict'

// ════════════════════════════════════════════════════════════
// Arithmétique sur les numéros de téléphone stockés en texte :
// BigInt (aucune perte de précision), « + » initial et largeur
// (zéros de tête) conservés.
// ════════════════════════════════════════════════════════════

const analyserNumero = (numero) => {
  const texte = String(numero === null || numero === undefined ? '' : numero).trim()
  const signe = texte.startsWith('+') ? '+' : ''
  const chiffres = texte.slice(signe.length)
  if (!/^\d{1,18}$/.test(chiffres)) return null
  return { signe, chiffres }
}

// decalerNumero('+33700000099', 1) → '+33700000100' ; null si format invalide
// ou si le résultat dépasse la largeur d'origine.
const decalerNumero = (numero, decalage) => {
  const analyse = analyserNumero(numero)
  if (!analyse) return null
  const valeur = BigInt(analyse.chiffres) + BigInt(decalage)
  if (valeur < 0n) return null
  const texte = valeur.toString().padStart(analyse.chiffres.length, '0')
  if (texte.length > analyse.chiffres.length) return null
  return analyse.signe + texte
}

// Compare deux numéros de même format : négatif, zéro ou positif.
const comparerNumeros = (a, b) => {
  const na = analyserNumero(a)
  const nb = analyserNumero(b)
  if (!na || !nb) return null
  const diff = BigInt(na.chiffres) - BigInt(nb.chiffres)
  return diff === 0n ? 0 : (diff < 0n ? -1 : 1)
}

module.exports = { analyserNumero, decalerNumero, comparerNumeros }
