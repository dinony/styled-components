// @flow
import hashStr from '../vendor/glamor/hash'
import type { Interpolation, NameGenerator, Stringifier } from '../types'
import StyleSheet from '../models/StyleSheet'

export default (
  nameGenerator: NameGenerator,
  stringifyRules: Stringifier,
  css: Function
) => (
  strings: Array<string>,
  ...interpolations: Array<Interpolation>
): string => {
  const rules = css(strings, ...interpolations)
  const hash = hashStr(rules.join(''))

  const existingName = StyleSheet.global.getNameForHash(hash)
  if (existingName !== undefined) {
    return existingName
  }

  const name = nameGenerator(hash)
  const id = `sc-keyframes-${name}`

  StyleSheet.global.inject(
    id,
    stringifyRules(rules, name, '@keyframes'),
    hash,
    name
  )

  return name
}
