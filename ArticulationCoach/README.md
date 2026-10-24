# Articulation Coach: speak like a CEO

A personal speaking coach that **listens to you**, gives **instant feedback and corrections**, runs a **15-minute daily session** of varied exercises, and **tracks your progress week by week**.

It is a single offline app (`index.html`). There is nothing to install and no account to create, and all your data stays on your computer.

## Put it on your desktop (one time)

1. Download this folder. On GitHub: **Code → Download ZIP**, then unzip it somewhere permanent, such as `Documents\ArticulationCoach`.
2. Install **Google Chrome** or **Microsoft Edge**. Live speech recognition only works in these two browsers.
3. Run the installer:
   - **Windows:** double-click `Install on Desktop (Windows).bat`.
   - **Mac:** right-click `Install on Desktop (Mac).command` → **Open**.
4. An **Articulation Coach** icon appears on your desktop. Double-click it every day. The app opens in its own window.
5. The first time you press **START**, click **Allow** to give the app microphone access.

> Do not move the folder after installing. If you do, run the installer again.
> Speech-to-text uses Chrome's or Edge's built-in speech service, so you need an internet connection while recording.

## Your daily 15 minutes

| # | Exercise | Time | What it trains |
|---|----------|------|----------------|
| 1 | Articulation warm-up (2 tongue twisters × 3) | 2 min | Crisp consonants, mouth agility |
| 2 | Executive read-aloud (CEO-style speeches) | 3 min | Authoritative tone, pace, pronunciation |
| 3 | Impromptu answer (PREP framework) | 3 min | Thinking on your feet |
| 4 | CEO scenario (board update, all-hands, media, investors…) | 4 min | Leadership communication with a framework |
| 5 | Rapid fire (3 × 20-second answers) | 3 min | Answer-first discipline |

The exercises change every day, and the tongue twisters get harder as you level up (Speaker → Presenter → … → CEO).

## What it measures and corrects

- **Clarity:** word-by-word accuracy on read-aloud drills, with missed words highlighted for practice.
- **Fluency:** filler words (um, uh, like, you know, basically…), repeated words and long stalls.
- **Pace:** words per minute against the executive range of 140–160.
- **Confidence:** hedging ("I think", "maybe", "kind of"), apologies and weak words, plus **uptalk** (statements that rise in pitch at the end).
- **Vocal delivery:** pitch variety (monotone detection) and the use of strategic pauses.
- **Structure:** whether you led with your answer (BLUF), used signposts (first / second / finally) and finished with a strong close.

After every take you get:

- a score for each skill
- specific coaching notes
- your transcript with every filler, hedge and weak word marked
- a **cleaner, more confident version** of what you said
- a recording you can play back

## Progress tracking

- Daily streak, XP and levels.
- A **weekly report**: this week vs. last week for every skill, filler rate, pace and rising endings, plus a written summary that names your biggest improvement and your focus for next week.
- **Since you started:** after the first week, your current scores compared with your baseline.
- 30-day trend charts and the full history of every take.

## Extra tools

- **Rehearse my speech:** paste any real presentation or pitch, deliver it, and get word-by-word accuracy and delivery feedback.
- **Free talk:** speak about anything for up to 3 minutes and get full feedback.
- **CEO Playbook:** weak-to-executive phrasing, frameworks (BLUF, PREP, SCR, Rule of Three…) and daily habits.
- **AI Coach (optional):** add an Anthropic API key in Settings to unlock deep, personalised feedback and a "how a CEO would say it" rewrite of each answer. The app calls `claude-opus-5-5` directly from your browser, with server-side fallback enabled in case a request is declined.
- **Backup:** export or import your progress as a file.

## Notes

- Some speech recognizers drop "um" and "uh" from transcripts, so treat the filler count as a minimum.
- Pitch, pause and uptalk scores are estimates from the audio. Use a headset or a quiet room for the best results.
- Your progress is saved in the browser profile used by the desktop shortcut. Use **Export** in Settings to back it up.
