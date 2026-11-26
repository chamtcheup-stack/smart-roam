import { Ionicons } from '@expo/vector-icons'
import type { ComponentProps, ReactNode } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { espace, rayon, taille, useTheme, type Ton } from './theme'

export type NomIcone = ComponentProps<typeof Ionicons>['name']

// ── Écran défilant ─────────────────────────────────────────
export function Ecran ({
  children,
  enTeteNavigation = false,
  surActualiser,
  actualisation = false
}: {
  children: ReactNode
  enTeteNavigation?: boolean // l'en-tête du navigateur gère déjà la zone sûre du haut
  surActualiser?: () => void
  actualisation?: boolean
}) {
  const { couleurs } = useTheme()
  const marges = useSafeAreaInsets()
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: couleurs.fond }}
      contentContainerStyle={{
        padding: espace.l,
        paddingTop: (enTeteNavigation ? 0 : marges.top) + espace.l,
        paddingBottom: marges.bottom + espace.xxl,
        gap: espace.l
      }}
      keyboardShouldPersistTaps='handled'
      refreshControl={surActualiser ? <RefreshControl refreshing={actualisation} onRefresh={surActualiser} tintColor={couleurs.primaire} /> : undefined}
    >
      {children}
    </ScrollView>
  )
}

// ── Textes ─────────────────────────────────────────────────
export function Titre ({ children, niveau = 1 }: { children: ReactNode; niveau?: 1 | 2 | 3 }) {
  const { couleurs } = useTheme()
  const tailles = { 1: taille.titre, 2: taille.grande, 3: taille.moyenne }
  return (
    <Text accessibilityRole='header' style={{ color: couleurs.texte, fontSize: tailles[niveau], fontWeight: '700' }}>
      {children}
    </Text>
  )
}

export function Texte ({ children, secondaire = false, petit = false, gras = false, centre = false, couleur }: {
  children: ReactNode
  secondaire?: boolean
  petit?: boolean
  gras?: boolean
  centre?: boolean
  couleur?: string
}) {
  const { couleurs } = useTheme()
  return (
    <Text
      style={{
        color: couleur || (secondaire ? couleurs.texteSecondaire : couleurs.texte),
        fontSize: petit ? taille.petite : taille.normale,
        fontWeight: gras ? '600' : '400',
        textAlign: centre ? 'center' : 'left',
        lineHeight: (petit ? taille.petite : taille.normale) * 1.4
      }}
    >
      {children}
    </Text>
  )
}

// ── Carte ──────────────────────────────────────────────────
export function Carte ({ children, accent = false, style }: { children: ReactNode; accent?: boolean; style?: StyleProp<ViewStyle> }) {
  const { couleurs } = useTheme()
  return (
    <View
      style={[{
        backgroundColor: accent ? couleurs.surfaceAccent : couleurs.surface,
        borderRadius: rayon.l,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: accent ? couleurs.primaire : couleurs.bordure,
        padding: espace.l,
        gap: espace.m
      }, style]}
    >
      {children}
    </View>
  )
}

export function EnTeteCarte ({ icone, titre, droite }: { icone?: NomIcone; titre: string; droite?: ReactNode }) {
  const { couleurs } = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: espace.s }}>
      {icone ? <Ionicons name={icone} size={20} color={couleurs.primaire} /> : null}
      <Text style={{ flex: 1, color: couleurs.texte, fontSize: taille.moyenne, fontWeight: '700' }}>{titre}</Text>
      {droite}
    </View>
  )
}

// ── Bouton ─────────────────────────────────────────────────
type VarianteBouton = 'primaire' | 'secondaire' | 'danger' | 'discret'

export function Bouton ({ titre, surAppui, variante = 'primaire', chargement = false, desactive = false, icone, compact = false }: {
  titre: string
  surAppui: () => void
  variante?: VarianteBouton
  chargement?: boolean
  desactive?: boolean
  icone?: NomIcone
  compact?: boolean
}) {
  const { couleurs } = useTheme()
  const styles: Record<VarianteBouton, { fond: string; texte: string; bordure: string }> = {
    primaire: { fond: couleurs.primaire, texte: couleurs.surPrimaire, bordure: couleurs.primaire },
    secondaire: { fond: 'transparent', texte: couleurs.texte, bordure: couleurs.texte },
    danger: { fond: 'transparent', texte: couleurs.danger, bordure: couleurs.danger },
    discret: { fond: 'transparent', texte: couleurs.texte, bordure: 'transparent' }
  }
  const style = styles[variante]
  const inactif = desactive || chargement
  return (
    <Pressable
      accessibilityRole='button'
      accessibilityState={{ disabled: inactif, busy: chargement }}
      accessibilityLabel={titre}
      disabled={inactif}
      onPress={surAppui}
      style={({ pressed }) => ({
        minHeight: compact ? 40 : 50,
        paddingHorizontal: compact ? espace.m : espace.l,
        borderRadius: rayon.m,
        borderWidth: variante === 'discret' ? 0 : 1.5,
        borderColor: style.bordure,
        backgroundColor: style.fond,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: espace.s,
        opacity: inactif ? 0.5 : pressed ? 0.75 : 1
      })}
    >
      {chargement
        ? <ActivityIndicator color={style.texte} />
        : (
          <>
            {icone ? <Ionicons name={icone} size={compact ? 16 : 18} color={style.texte} /> : null}
            <Text style={{ color: style.texte, fontSize: compact ? taille.petite : taille.normale, fontWeight: '700', textDecorationLine: variante === 'discret' ? 'underline' : 'none' }}>
              {titre}
            </Text>
          </>
          )}
    </Pressable>
  )
}

// ── Champ de saisie ────────────────────────────────────────
export function Champ ({ libelle, erreur, aide, ...proprietes }: TextInputProps & { libelle: string; erreur?: string | null; aide?: string }) {
  const { couleurs } = useTheme()
  return (
    <View style={{ gap: espace.xs }}>
      <Text style={{ color: couleurs.texte, fontSize: taille.petite, fontWeight: '600' }}>{libelle}</Text>
      <TextInput
        accessibilityLabel={libelle}
        placeholderTextColor={couleurs.texteSecondaire}
        {...proprietes}
        style={{
          minHeight: 50,
          borderRadius: rayon.m,
          borderWidth: 1.5,
          borderColor: erreur ? couleurs.danger : couleurs.bordure,
          backgroundColor: couleurs.surface,
          color: couleurs.texte,
          paddingHorizontal: espace.l,
          fontSize: taille.moyenne
        }}
      />
      {erreur
        ? <Text style={{ color: couleurs.danger, fontSize: taille.petite }}>{erreur}</Text>
        : aide ? <Text style={{ color: couleurs.texteSecondaire, fontSize: taille.petite }}>{aide}</Text> : null}
    </View>
  )
}

// Code PIN (4 chiffres, masqué) ou code SMS (6 chiffres, visible).
export function ChampCode ({ libelle, valeur, surChangement, longueur = 4, masque = true, erreur, autoFocus = false }: {
  libelle: string
  valeur: string
  surChangement: (texte: string) => void
  longueur?: number
  masque?: boolean
  erreur?: string | null
  autoFocus?: boolean
}) {
  const { couleurs } = useTheme()
  return (
    <View style={{ gap: espace.xs }}>
      <Text style={{ color: couleurs.texte, fontSize: taille.petite, fontWeight: '600' }}>{libelle}</Text>
      <TextInput
        accessibilityLabel={libelle}
        value={valeur}
        onChangeText={(texte) => surChangement(texte.replace(/\D/g, '').slice(0, longueur))}
        keyboardType='number-pad'
        secureTextEntry={masque}
        maxLength={longueur}
        autoFocus={autoFocus}
        textContentType={masque ? 'password' : 'oneTimeCode'}
        autoComplete={masque ? 'off' : 'sms-otp'}
        placeholder={'•'.repeat(longueur)}
        placeholderTextColor={couleurs.texteSecondaire}
        style={{
          minHeight: 56,
          borderRadius: rayon.m,
          borderWidth: 1.5,
          borderColor: erreur ? couleurs.danger : couleurs.bordure,
          backgroundColor: couleurs.surface,
          color: couleurs.texte,
          fontSize: taille.grande,
          letterSpacing: 12,
          textAlign: 'center'
        }}
      />
      {erreur ? <Text style={{ color: couleurs.danger, fontSize: taille.petite }}>{erreur}</Text> : null}
    </View>
  )
}

// ── Badge de statut ────────────────────────────────────────
export function Badge ({ texte, ton = 'neutre' }: { texte: string; ton?: Ton }) {
  const { tons } = useTheme()
  return (
    <View style={{ alignSelf: 'flex-start', backgroundColor: tons[ton].fond, borderRadius: rayon.plein, paddingHorizontal: espace.m, paddingVertical: 3 }}>
      <Text style={{ color: tons[ton].texte, fontSize: taille.petite, fontWeight: '700' }}>{texte}</Text>
    </View>
  )
}

// ── Choix parmi des options (puces) ────────────────────────
export function Puces<T extends string> ({ options, valeur, surChoix, libelle }: {
  options: { valeur: T; texte: string }[]
  valeur: T | null
  surChoix: (valeur: T) => void
  libelle?: string
}) {
  const { couleurs } = useTheme()
  return (
    <View style={{ gap: espace.xs }}>
      {libelle ? <Text style={{ color: couleurs.texte, fontSize: taille.petite, fontWeight: '600' }}>{libelle}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espace.s }} role='radiogroup' aria-label={libelle}>
        {options.map((option) => {
          const actif = option.valeur === valeur
          return (
            <Pressable
              key={option.valeur}
              role='radio'
              aria-checked={actif}
              onPress={() => surChoix(option.valeur)}
              style={{
                paddingHorizontal: espace.m,
                minHeight: 40,
                justifyContent: 'center',
                borderRadius: rayon.plein,
                borderWidth: 1.5,
                borderColor: actif ? couleurs.primaire : couleurs.bordure,
                backgroundColor: actif ? couleurs.primaire : couleurs.surface
              }}
            >
              <Text style={{ color: actif ? couleurs.surPrimaire : couleurs.texte, fontWeight: actif ? '700' : '500', fontSize: taille.normale }}>
                {option.texte}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

// ── Messages ───────────────────────────────────────────────
export function Message ({ texte, ton = 'info' }: { texte: string | null | undefined; ton?: Ton }) {
  const { tons } = useTheme()
  if (!texte) return null
  const icones: Record<Ton, NomIcone> = {
    succes: 'checkmark-circle',
    alerte: 'warning',
    danger: 'alert-circle',
    info: 'information-circle',
    neutre: 'information-circle',
    primaire: 'sparkles'
  }
  return (
    <View
      accessibilityRole={ton === 'danger' ? 'alert' : 'text'}
      style={{ flexDirection: 'row', gap: espace.s, alignItems: 'flex-start', backgroundColor: tons[ton].fond, borderRadius: rayon.m, padding: espace.m }}
    >
      <Ionicons name={icones[ton]} size={18} color={tons[ton].texte} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: tons[ton].texte, fontSize: taille.normale, lineHeight: taille.normale * 1.4 }}>{texte}</Text>
    </View>
  )
}

// ── Ligne libellé / valeur ─────────────────────────────────
export function Ligne ({ libelle, valeur }: { libelle: string; valeur: ReactNode }) {
  const { couleurs } = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: espace.m }}>
      <Text style={{ color: couleurs.texteSecondaire, fontSize: taille.normale }}>{libelle}</Text>
      {typeof valeur === 'string' || typeof valeur === 'number'
        ? <Text style={{ color: couleurs.texte, fontSize: taille.normale, fontWeight: '600', flexShrink: 1, textAlign: 'right' }}>{valeur}</Text>
        : valeur}
    </View>
  )
}

// ── Élément de liste pressable ─────────────────────────────
export function ElementListe ({ titre, sousTitre, droite, surAppui, icone }: {
  titre: string
  sousTitre?: string
  droite?: ReactNode
  surAppui?: () => void
  icone?: NomIcone
}) {
  const { couleurs } = useTheme()
  return (
    <Pressable
      accessibilityRole={surAppui ? 'button' : undefined}
      onPress={surAppui}
      disabled={!surAppui}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: espace.m, paddingVertical: espace.s, opacity: pressed ? 0.6 : 1 })}
    >
      {icone ? <Ionicons name={icone} size={22} color={couleurs.texteSecondaire} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: couleurs.texte, fontSize: taille.normale, fontWeight: '600' }}>{titre}</Text>
        {sousTitre ? <Text style={{ color: couleurs.texteSecondaire, fontSize: taille.petite }}>{sousTitre}</Text> : null}
      </View>
      {droite}
      {surAppui ? <Ionicons name='chevron-forward' size={18} color={couleurs.texteSecondaire} /> : null}
    </Pressable>
  )
}

// ── Divers ─────────────────────────────────────────────────
export function Avatar ({ nom, couleur, tailleCercle = 56 }: { nom: string; couleur?: string; tailleCercle?: number }) {
  const { couleurs } = useTheme()
  const initiales = nom.split(/\s+/).filter((mot) => /^\p{L}/u.test(mot)).slice(0, 2).map((mot) => mot[0].toUpperCase()).join('') || '?'
  return (
    <View
      accessibilityLabel={`Photo de profil : ${nom}`}
      style={{ width: tailleCercle, height: tailleCercle, borderRadius: tailleCercle / 2, backgroundColor: couleur || couleurs.primaire, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: couleur ? '#FFFFFF' : couleurs.surPrimaire, fontSize: tailleCercle * 0.38, fontWeight: '700' }}>{initiales}</Text>
    </View>
  )
}

export function Separateur () {
  const { couleurs } = useTheme()
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: couleurs.bordure }} />
}

export function Chargement ({ texte = 'Chargement…' }: { texte?: string }) {
  const { couleurs } = useTheme()
  return (
    <View style={{ padding: espace.xl, alignItems: 'center', gap: espace.m }}>
      <ActivityIndicator color={couleurs.primaire} size='large' />
      <Text style={{ color: couleurs.texteSecondaire }}>{texte}</Text>
    </View>
  )
}

export function EtatVide ({ icone, texte }: { icone: NomIcone; texte: string }) {
  const { couleurs } = useTheme()
  return (
    <View style={{ alignItems: 'center', gap: espace.s, paddingVertical: espace.l }}>
      <Ionicons name={icone} size={32} color={couleurs.texteSecondaire} />
      <Text style={{ color: couleurs.texteSecondaire, textAlign: 'center' }}>{texte}</Text>
    </View>
  )
}

export function Rangee ({ children, espacement = espace.s }: { children: ReactNode; espacement?: number }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: espacement, alignItems: 'center' }}>{children}</View>
}
