// The art preview page's script: keep / redo / notes on every item.
//
// Published as an Artifact with the `db` capability, verdicts go to the
// shared `verdicts` collection, one document per item:
// { item, verdict ('keep' | 'redo' | null), notes, art, updatedAt }, where
// `art` is the fingerprint of the picture the verdict was given on. Claude
// reads them back from there. A verdict whose `art` no longer matches the
// picture shows as "changed since your verdict" and counts as undecided.
// Where there is no database (a local file, a view without it, a save the
// store refused) verdicts stay in this browser, and the JSON box at the
// foot of the page carries them to Claude by hand.

(function () {
  'use strict'

  var LOCAL_KEY = 'squishys-art-preview:verdicts'
  var NOTE_PAUSE_MS = 700

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'))
  var cardOf = {}
  cards.forEach(function (card) { cardOf[card.dataset.item] = card })

  /** item id -> { verdict: 'keep' | 'redo' | '', notes: string, art: string } */
  var verdicts = {}
  /** 'connecting' | 'shared' | 'local' */
  var mode = 'connecting'
  var collection = null
  var writes = {}
  var noteTimers = {}
  /** Items changed before the store answered, saved once it has */
  var changedWhileConnecting = {}

  var status = document.getElementById('status')
  var json = document.getElementById('json')

  function stored(item) {
    return verdicts[item] || { verdict: '', notes: '', art: '' }
  }

  /** The verdict that holds for the picture on the page now: '' if none, or if the art changed since. */
  function standing(item) {
    var current = stored(item)
    return current.verdict && current.art === cardOf[item].dataset.art ? current.verdict : ''
  }

  function isStale(item) {
    var current = stored(item)
    return Boolean(current.verdict) && current.art !== cardOf[item].dataset.art
  }

  function setMode(next, message) {
    mode = next
    status.dataset.mode = next
    status.textContent = message
  }

  // Drawing ---------------------------------------------------------------

  function show(item) {
    var card = cardOf[item]
    if (!card) return
    var verdict = standing(item)
    card.dataset.verdict = verdict
    card.querySelectorAll('.verdict button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.verdict === verdict))
    })
    var changed = card.querySelector('.changed')
    changed.hidden = !isStale(item)
    if (!changed.hidden) {
      changed.textContent = 'Changed since your verdict (' + stored(item).verdict + '). Keep or redo the new picture.'
    }
    var notes = card.querySelector('textarea')
    var text = stored(item).notes
    if (document.activeElement !== notes && !noteTimers[item] && notes.value !== text) notes.value = text
  }

  function showAll() {
    cards.forEach(function (card) { show(card.dataset.item) })
    showTally()
  }

  function showTally() {
    var keep = 0
    var redo = 0
    var listed = []
    cards.forEach(function (card) {
      var item = card.dataset.item
      var current = stored(item)
      var verdict = standing(item)
      if (verdict === 'keep') keep += 1
      if (verdict === 'redo') redo += 1
      if (current.verdict || current.notes) {
        listed.push({
          item: item,
          verdict: current.verdict || null,
          notes: current.notes,
          art: current.art,
          changedSinceVerdict: isStale(item),
        })
      }
    })
    document.getElementById('t-keep').textContent = keep
    document.getElementById('t-redo').textContent = redo
    document.getElementById('t-open').textContent = cards.length - keep - redo
    json.value = JSON.stringify(listed, null, 2)
  }

  // Saving ----------------------------------------------------------------

  function readLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY)
      var parsed = raw ? JSON.parse(raw) : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch (error) {
      return {}
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(LOCAL_KEY, JSON.stringify(verdicts))
    } catch (error) {
      // Storage blocked: the verdicts last as long as the page, and the JSON box still has them
    }
  }

  function documentFor(item) {
    var current = stored(item)
    return {
      item: item,
      verdict: current.verdict || null,
      notes: current.notes,
      art: current.art,
      updatedAt: new Date().toISOString(),
    }
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms) })
  }

  /** Saving to the store failed for good: keep going in this browser instead. */
  function fallBackToLocal(reason) {
    if (mode === 'local') return
    setMode('local', reason + ' Verdicts now save in this browser only. Copy the JSON at the foot of the page to pass them on.')
    status.dataset.mode = 'fallback'
    writeLocal()
  }

  function save(item) {
    if (mode === 'connecting') {
      changedWhileConnecting[item] = true
    } else if (mode === 'local') {
      writeLocal()
    } else {
      var docId = cardOf[item].dataset.doc
      var write = function () { return collection.doc(docId).set(documentFor(item)) }
      // One write at a time per document, each sending the latest verdict
      writes[docId] = (writes[docId] || Promise.resolve()).then(function () {
        if (mode !== 'shared') return
        return write().catch(function (error) {
          // A passing hiccup: try once more after a short, random pause
          if (error && error.code === 'unavailable') return wait(300 + Math.random() * 700).then(write)
          throw error
        })
      }).catch(function (error) {
        var code = error && error.code
        fallBackToLocal(
          code === 'invalid_argument'
            ? 'You can see the shared verdicts but not change them.'
            : code === 'quota_exceeded'
              ? 'The shared verdicts are full.'
              : 'The shared verdicts could not be reached.',
        )
      })
    }
  }

  function receive(snapshot) {
    var next = {}
    snapshot.docs.forEach(function (doc) {
      var data = doc.data()
      if (!data || typeof data.item !== 'string' || !cardOf[data.item]) return
      next[data.item] = {
        verdict: data.verdict === 'keep' || data.verdict === 'redo' ? data.verdict : '',
        notes: typeof data.notes === 'string' ? data.notes : '',
        art: typeof data.art === 'string' ? data.art : '',
      }
    })
    // An item missing from the store (its verdict deleted) is undecided again,
    // except where an edit made here hasn't reached the store yet
    Object.keys(verdicts).forEach(function (item) {
      if (changedWhileConnecting[item]) next[item] = verdicts[item]
      else if (noteTimers[item]) next[item] = Object.assign({}, next[item] || stored(item), { notes: verdicts[item].notes })
    })
    verdicts = next
    showAll()
  }

  function flushChangedWhileConnecting() {
    var items = Object.keys(changedWhileConnecting)
    changedWhileConnecting = {}
    items.forEach(save)
  }

  function useShared(db) {
    collection = db.collection('verdicts')
    setMode('shared', 'Verdicts save to the shared verdicts, where Claude can read them.')
    var first = true
    collection.onSnapshot(function (snapshot) {
      receive(snapshot)
      if (first) {
        first = false
        // Never write from inside the snapshot callback
        setTimeout(flushChangedWhileConnecting, 0)
      }
    }, function () {
      fallBackToLocal('The shared verdicts stopped answering.')
    })
  }

  function useLocal() {
    var kept = readLocal()
    Object.keys(kept).forEach(function (item) {
      var entry = kept[item]
      if (changedWhileConnecting[item] || !entry || !cardOf[item]) return
      verdicts[item] = { verdict: entry.verdict || '', notes: entry.notes || '', art: entry.art || '' }
    })
    changedWhileConnecting = {}
    setMode('local', 'No shared verdicts here, so verdicts save in this browser only. Copy the JSON at the foot of the page to pass them on.')
    writeLocal()
    showAll()
  }

  // Controls ---------------------------------------------------------------

  cards.forEach(function (card) {
    var item = card.dataset.item
    card.querySelectorAll('.verdict button').forEach(function (button) {
      button.addEventListener('click', function () {
        var picked = button.dataset.verdict
        var verdict = standing(item) === picked ? '' : picked
        verdicts[item] = { verdict: verdict, notes: stored(item).notes, art: card.dataset.art }
        show(item)
        showTally()
        save(item)
      })
    })
    var notes = card.querySelector('textarea')
    var flush = function () {
      if (!noteTimers[item]) return
      clearTimeout(noteTimers[item])
      delete noteTimers[item]
      save(item)
    }
    notes.addEventListener('input', function () {
      var current = stored(item)
      // A verdict keeps the art it was given on; notes alone are on today's art
      verdicts[item] = { verdict: current.verdict, notes: notes.value, art: current.verdict ? current.art : card.dataset.art }
      showTally()
      clearTimeout(noteTimers[item])
      noteTimers[item] = setTimeout(flush, NOTE_PAUSE_MS)
    })
    notes.addEventListener('blur', flush)
  })

  document.querySelectorAll('.filter input').forEach(function (input) {
    input.addEventListener('change', function () {
      if (input.checked) document.getElementById('sheet').dataset.filter = input.value
    })
  })

  document.getElementById('copy').addEventListener('click', function () {
    var copyStatus = document.getElementById('copy-status')
    var selectInstead = function () {
      json.focus()
      json.select()
      copyStatus.textContent = 'Selected. Press Ctrl+C or Cmd+C to copy.'
    }
    try {
      navigator.clipboard.writeText(json.value).then(function () { copyStatus.textContent = 'Copied.' }, selectInstead)
    } catch (error) {
      selectInstead()
    }
  })

  // Start -------------------------------------------------------------------

  showAll()
  if (window.claude && typeof window.claude.use === 'function') {
    window.claude.use('db').then(function (db) {
      if (db) useShared(db)
      else useLocal()
    }, useLocal)
  } else {
    useLocal()
  }
})()
