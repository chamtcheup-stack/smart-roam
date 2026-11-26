// Mêmes règles que le serveur (algo 11) : chiffres identiques et suites refusés.
const PIN_TRIVIAUX = new Set([
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  '0123', '1234', '2345', '3456', '4567', '5678', '6789',
  '9876', '8765', '7654', '6543', '5432', '4321', '3210'
])

// Message d'erreur du nouveau PIN, ou null s'il est acceptable.
export const verifierNouveauPin = (pin: string, confirmation: string): string | null => {
  if (pin.length !== 4) return 'Le PIN comporte 4 chiffres'
  if (PIN_TRIVIAUX.has(pin)) return 'PIN trop simple : évitez les chiffres identiques et les suites (ex. 1234)'
  if (confirmation.length === 4 && confirmation !== pin) return 'Les deux PIN ne correspondent pas'
  return null
}
