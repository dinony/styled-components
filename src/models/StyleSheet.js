// @flow
/* eslint-disable flowtype/object-type-delimiter */

import React from 'react'
import getNonce from '../utils/nonce'

export const SC_ATTR = 'data-styled-components'
export const CONTEXT_KEY = '__styled-components-stylesheet__'

declare var __DEV__: ?string

const IS_BROWSER = typeof window !== 'undefined'

const DISABLE_SPEEDY =
  (typeof __DEV__ === 'boolean' && __DEV__) ||
  process.env.NODE_ENV !== 'production'

/* determine the maximum number of components before tags are sharded */
let MAX_SIZE
if (IS_BROWSER) {
  /* in speedy mode we can keep a lot more rules in a sheet before a slowdown can be expected */
  MAX_SIZE = DISABLE_SPEEDY ? 40 : 1000
} else {
  /* for servers we do not need to shard at all */
  MAX_SIZE = -1
}

/* this error is used for makeStyleTag */
const parentNodeUnmountedErr =
  process.env.NODE_ENV !== 'production'
    ? `
Trying to insert a new style tag, but the given Node is unmounted!
- Are you using a custom target that isn't mounted?
- Does your document not have a valid head element?
- Have you accidentally removed a style tag manually?
`.trim()
    : ''

/* this marker separates component styles and is important for rehydration */
const makeTextMarker = id => `\n/* sc-component-id: ${id} */\n`

/* access last item in array (used to get the latest tag) */
const last = <T>(arr: T[]): T => arr[arr.length - 1]

/* retrieve a sheet for a given style tag */
const sheetForTag = (tag: HTMLStyleElement): CSSStyleSheet => {
  // $FlowFixMe
  if (tag.sheet) return tag.sheet

  /* Firefox quirk requires us to step through all stylesheets to find one owned by the given tag */
  const size = document.styleSheets.length
  for (let i = 0; i < size; i += 1) {
    const sheet = document.styleSheets[i]
    // $FlowFixMe
    if (sheet.ownerNode === tag) return sheet
  }

  /* we should always be able to find a tag */
  throw new Error()
}

/* insert a rule safely and return whether it was actually injected */
const safeInsertRule = (
  sheet: CSSStyleSheet,
  cssRule: string,
  index: number
): boolean => {
  /* abort early if cssRule string is falsy */
  if (!cssRule) return false

  const maxIndex = sheet.cssRules.length

  try {
    /* use insertRule and cap passed index with maxIndex (no of cssRules) */
    sheet.insertRule(cssRule, index <= maxIndex ? index : maxIndex)
  } catch (err) {
    /* any error indicates an invalid rule */
    return false
  }

  return true
}

/* insert multiple rules using safeInsertRule */
const safeInsertRules = (
  sheet: CSSStyleSheet,
  cssRules: string[],
  insertIndex: number
): number => {
  /* inject each rule and count up the number of actually injected ones */
  let injectedRules = 0
  const cssRulesSize = cssRules.length
  for (let i = 0; i < cssRulesSize; i += 1) {
    const cssRule = cssRules[i]
    if (safeInsertRule(sheet, cssRule, insertIndex + injectedRules)) {
      injectedRules += 1
    }
  }

  /* return number of injected rules */
  return injectedRules
}

/* add up all numbers in array up until and including the index */
const addUpUntilIndex = (sizes: number[], index: number): number => {
  let totalUpToIndex = 0
  for (let i = 0; i <= index; i += 1) {
    totalUpToIndex += sizes[i]
  }

  return totalUpToIndex
}

/* create a new style tag after lastEl */
const makeStyleTag = (target: ?HTMLElement, lastTag: ?Node) => {
  const el = document.createElement('style')
  el.type = 'text/css'
  el.setAttribute(SC_ATTR, '')

  const nonce = getNonce()
  if (nonce) {
    el.setAttribute('nonce', nonce)
  }

  /* Work around insertRule quirk in EdgeHTML */
  el.appendChild(document.createTextNode(''))

  if (target && !lastTag) {
    /* Append to target when no previous element was passed */
    target.appendChild(el)
  } else {
    if (!lastTag || !target || !lastTag.parentNode) {
      throw new Error(parentNodeUnmountedErr)
    }

    /* Insert new style tag after the previous one */
    lastTag.parentNode.insertBefore(el, lastTag.nextSibling)
  }

  return el
}

interface Tag<T> {
  styleTag?: HTMLStyleElement;
  insertMarker(id: string): T;
  insertRules(id: string, cssRules: string[]): void;
  css(): string;
  html(): string;
}

/* takes a css factory function and outputs an html styled tag factory */
const wrapAsHtmlTag = (css: () => string) => (): string =>
  `<style type="text/css" ${SC_ATTR}>${css()}</style>`

/* speedy tags utilise insertRule */
const makeSpeedyTag = (el: HTMLStyleElement): Tag<number> => {
  const markers = Object.create(null)
  const sizes = []

  const insertMarker = id => {
    const prev = markers[id]
    if (prev !== undefined) {
      return prev
    }

    const marker = (markers[id] = sizes.length)
    sizes.push(0)
    return marker
  }

  const insertRules = (id, cssRules) => {
    const marker = insertMarker(id)
    const sheet = sheetForTag(el)
    const insertIndex = addUpUntilIndex(sizes, marker)
    sizes[marker] += safeInsertRules(sheet, cssRules, insertIndex)
  }

  const css = () => {
    const { cssRules } = sheetForTag(el)
    let str = ''
    let i = 0

    // eslint-disable-next-line guard-for-in
    for (const id in markers) {
      str += makeTextMarker(id)
      const end = markers[id] + i
      for (; i < end; i += 1) {
        str += cssRules[i].cssText
      }
    }

    return str
  }

  return {
    styleTag: el,
    insertMarker,
    insertRules,
    css,
    html: wrapAsHtmlTag(css),
  }
}

const makeBrowserTag = (el: HTMLStyleElement): Tag<Text> => {
  const markers = Object.create(null)
  const insertMarker = id => {
    const prev = markers[id]
    if (prev !== undefined) {
      return prev
    }

    const marker = (markers[id] = document.createTextNode(makeTextMarker(id)))
    el.appendChild(marker)
    return marker
  }

  const insertRules = (id, cssRules) => {
    insertMarker(id).appendData(cssRules.join(' '))
  }

  const css = () => {
    let str = ''
    // eslint-disable-next-line guard-for-in
    for (const id in markers) {
      str += markers[id].data
    }
    return str
  }

  return {
    styleTag: el,
    insertMarker,
    insertRules,
    css,
    html: wrapAsHtmlTag(css),
  }
}

const makeServerTag = (): Tag<[string]> => {
  const markers = Object.create(null)

  const insertMarker = id => {
    const prev = markers[id]
    if (prev !== undefined) {
      return prev
    }

    return (markers[id] = [makeTextMarker(id)])
  }

  const insertRules = (id, cssRules) => {
    const marker = insertMarker(id)
    marker[0] += cssRules.join(' ')
  }

  const css = () => {
    let str = ''
    // eslint-disable-next-line guard-for-in
    for (const id in markers) {
      str += markers[id][0]
    }
    return str
  }

  return {
    insertMarker,
    insertRules,
    css,
    html: wrapAsHtmlTag(css),
  }
}

const makeTag = (
  target: ?HTMLElement,
  lastEl: ?Node,
  forceServer?: boolean
): Tag<any> => {
  if (IS_BROWSER && !forceServer) {
    const el = makeStyleTag(target, lastEl)
    if (DISABLE_SPEEDY) {
      return makeBrowserTag(el)
    } else {
      return makeSpeedyTag(el)
    }
  }

  return makeServerTag()
}

let sheetRunningId = 0
let global

class StyleSheet {
  id: number
  forceServer: boolean
  target: ?HTMLElement
  tagMap: { [string]: Tag<any> }
  hashes: { [string]: string }
  deferred: { [string]: string[] }
  tags: Tag<any>[]
  capacity: number

  constructor(
    target: ?HTMLElement = IS_BROWSER ? document.head : null,
    forceServer?: boolean = false
  ) {
    const firstTag = makeTag(target, null, forceServer)

    this.id = sheetRunningId += 1
    this.forceServer = forceServer
    this.target = target
    this.tagMap = {}
    this.hashes = {}
    this.deferred = {}
    this.tags = [firstTag]
    this.capacity = MAX_SIZE
  }

  /* retrieve a "global" instance of StyleSheet which is typically used when no other is available */
  static get global() {
    return global || (global = new StyleSheet())
  }

  /* reset the internal "global" instance */
  static reset(forceServer?: boolean = false) {
    global = new StyleSheet(undefined, forceServer)
  }

  /* get a tag for a given componentId, assign the componentId to one, or shard */
  getTagForId(id: string): Tag<any> {
    /* simply return a tag, when the componentId was already assigned one */
    const prev = this.tagMap[id]
    if (prev !== undefined) {
      return prev
    }

    let tag = last(this.tags)

    /* shard (create a new tag) if the tag is exhausted (See MAX_SIZE) */
    this.capacity -= 1
    if (this.capacity === 0) {
      this.capacity = MAX_SIZE
      tag = makeTag(this.target, tag.styleTag, this.forceServer)
      this.tags.push(tag)
    }

    return (this.tagMap[id] = tag)
  }

  /* retrieve cached name for hash */
  getNameForHash(hash: string) {
    return this.hashes[hash]
  }

  /* checks whether component is already registered */
  hasInjectedComponent(id: string): boolean {
    return !!this.tagMap[id]
  }

  /* registers a componentId and registers it on its tag */
  deferredInject(id: string, cssRules: string[]) {
    this.getTagForId(id).insertMarker(id)
    this.deferred[id] = cssRules
  }

  inject(id: string, cssRules: string[], hash: string, name: string) {
    let injectRules = cssRules
    const deferredRules = this.deferred[id]
    if (deferredRules !== undefined) {
      injectRules = deferredRules.concat(injectRules)
      delete this.deferred[id]
    }

    this.getTagForId(id).insertRules(id, injectRules)
    this.hashes[hash] = name
  }

  toHTML() {
    return this.tags.map(tag => tag.html()).join('')
  }

  toReactElements() {
    const { id } = this
    const props = {
      type: 'text/css',
      [SC_ATTR]: '',
    }

    return this.tags.map((tag, i) => (
      <style {...props} key={`sc-${id}-${i}`}>
        {tag.css()}
      </style>
    ))
  }
}

export default StyleSheet
