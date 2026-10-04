// The art preview page's script: keep / redo / notes on every item.
//
// Published as an Artifact with the `db` capability, verdicts go to the
// shared `verdicts` collection, one document per item: { item, verdict
// ('keep' | 'redo' | null), notes, updatedAt }, so Claude can read them
// back. Where there is no database (a local file, a view without it) they
// stay in this browser, and the JSON box at the foot of the page carries
// them to Claude by hand.

(function () {
  'use strict'

  var LOCAL_KEY = 'squishys-art-preview:verdicts'
  var NOTE_PAUSE_MS = 700

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'))
  var cardOf = {}
  cards.forEach(function (card) { cardOf[card.dataset.item] = card })

  /** item id -> { verdict: 'keep' | 'redo' | '', notes: string } */
  var verdicts = {}
  /** 'connecting' | 'shared' | 'local' | 'readonly' | 'error' */
  var mode = 'connecting'
  var collection = null
  var writes = {}
  var noteTimers = {}
  var changedWhileConnecting = {}

  var status = document.getElementById('status')
  var json = document.getElementById('json')

  function verdictOf(item) {
    return verdicts[item] || { verdict: '', notes: '' }
  }

  function setMode(next, message) {
    mode = next
    status.dataset.mode = next
    status.textContent = message
    var locked = next === 'readonly'
    cards.forEach(function (card) {
      card.querySelectorAll('button, textarea').forEach(function (control) { control.disabled = locked })
    })
  }

  // Drawing ---------------------------------------------------------------

  function show(item) {
    var card = cardOf[item]
    if (!card) return
    var current = verdictOf(item)
    card.dataset.verdict = current.verdict
    card.querySelectorAll('.verdict button').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.verdict === current.verdict))
    })
    var notes = card.querySelector('textarea')
    if (document.activeElement !== notes && !noteTimers[item] && notes.value !== current.notes) {
      notes.value = current.notes
    }
  }

  function showAll() {
    cards.forEach(function (card) { show(card.dataset.item) })
    showTally()
  }

  function showTally() {
    var keep = 0
    var redo = 0
    var decided = []
    cards.forEach(function (card) {
      var item = card.dataset.item
      var current = verdictOf(item)
      if (current.verdict === 'keep') keep += 1
      if (current.verdict === 'redo') redo += 1
      if (current.verdict || current.notes) {
        decided.push({ item: item, verdict: current.verdict || null, notes: current.notes })
      }
    })
    document.getElementById('t-keep').textContent = keep
    document.getElementById('t-redo').textContent = redo
    document.getElementById('t-open').textContent = cards.length - keep - redo
    json.value = JSON.stringify(decided, null, 2)
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

  function save(item) {
    if (mode === 'connecting') {
      changedWhileConnecting[item] = true
    } else if (mode === 'local') {
      writeLocal()
    } else if (mode === 'shared') {
      var docId = cardOf[item].dataset.doc
      // One write at a time per document, each sending the latest verdict
      writes[docId] = (writes[docId] || Promise.resolve()).then(function () {
        if (mode !== 'shared') return
        var current = verdictOf(item)
        return collection.doc(docId).set({
          item: item,
          verdict: current.verdict || null,
          notes: current.notes,
          updatedAt: new Date().toISOString(),
        })
      }).catch(function (error) {
        if (error && error.code === 'invalid_argument') {
          setMode('readonly', 'You can see the verdicts here but not change them. Ask the page owner for edit access.')
        } else if (error && error.code === 'quota_exceeded') {
          setMode('error', 'The shared verdicts are full, so this change was not saved. Copy the JSON below instead.')
        } else {
          setMode('error', 'This change could not be saved to the shared verdicts. Reload the page to try again, or copy the JSON below.')
        }
      })
    }
  }

  function receive(snapshot) {
    snapshot.docs.forEach(function (doc) {
      var data = doc.data()
      if (!data || typeof data.item !== 'string' || !cardOf[data.item]) return
      var local = verdictOf(data.item)
      verdicts[data.item] = {
        verdict: data.verdict === 'keep' || data.verdict === 'redo' ? data.verdict : '',
        // Notes still being typed here win over what the store has
        notes: noteTimers[data.item] ? local.notes : typeof data.notes === 'string' ? data.notes : '',
      }
    })
    showAll()
  }

  function useShared(db) {
    collection = db.collection('verdicts')
    setMode('shared', 'Verdicts save to the shared verdicts, where Claude can read them.')
    var first = true
    collection.onSnapshot(function (snapshot) {
      // Changes made before the store answered keep their place over its copy
      var pending = first ? Object.keys(changedWhileConnecting) : []
      var kept = pending.map(function (item) { return [item, verdictOf(item)] })
      receive(snapshot)
      kept.forEach(function (entry) { verdicts[entry[0]] = entry[1]; save(entry[0]) })
      if (pending.length > 0) showAll()
      first = false
    }, function () {
      setMode('error', 'The shared verdicts stopped updating. Reload the page to reconnect.')
    })
  }

  function useLocal() {
    var stored = readLocal()
    Object.keys(stored).forEach(function (item) {
      if (!changedWhileConnecting[item] && stored[item] && cardOf[item]) {
        verdicts[item] = { verdict: stored[item].verdict || '', notes: stored[item].notes || '' }
      }
    })
    setMode('local', 'No shared verdicts here, so verdicts save in this browser only. Copy the JSON at the foot of the page to pass them on.')
    writeLocal()
    showAll()
  }

  // Controls ---------------------------------------------------------------

  cards.forEach(function (card) {
    var item = card.dataset.item
    card.querySelectorAll('.verdict button').forEach(function (button) {
      button.addEventListener('click', function () {
        var current = verdictOf(item)
        var picked = button.dataset.verdict
        verdicts[item] = { verdict: current.verdict === picked ? '' : picked, notes: current.notes }
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
      verdicts[item] = { verdict: verdictOf(item).verdict, notes: notes.value }
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
    var said = document.getElementById('copy-status')
    var fallback = function () {
      json.focus()
      json.select()
      said.textContent = 'Selected. Press Ctrl+C or Cmd+C to copy.'
    }
    try {
      navigator.clipboard.writeText(json.value).then(function () { said.textContent = 'Copied.' }, fallback)
    } catch (error) {
      fallback()
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
