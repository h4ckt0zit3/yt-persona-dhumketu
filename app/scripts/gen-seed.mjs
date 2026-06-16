// Generates src/generated/seedData.ts by inlining the repo's reference CSVs
// (niches + channels master) plus a few authored sample transcripts, so the
// worker can seed a fully testable system with zero manual CSV uploads.
//
//   node scripts/gen-seed.mjs
//
// Re-run whenever the master CSVs change.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')
const appRoot = resolve(here, '..')

const nichesCsv = readFileSync(resolve(repoRoot, '01-niches-database', 'niches-master.csv'), 'utf8')
const channelsCsv = readFileSync(resolve(repoRoot, '02-channels-database', 'channels-master.csv'), 'utf8')

// Demo channel for the fully-offline persona test. Tied to a real, recognizable
// monologue/explainer creator so the resulting persona reads believably.
const DEMO_NICHE = {
  niche_id: 'N051',
  domain: 'Education',
  niche: 'Science Communication',
  sub_niche: 'Physics and engineering explainers',
  format_type: 'Monologue',
  avg_cpm_usd: '8-15',
  difficulty: 'Medium',
  persona_potential: 'High',
  description: 'Visual science education making complex topics accessible',
}

const DEMO_CHANNEL = {
  channel_id: 'CH9001',
  niche_id: 'N051',
  channel_name: 'Veritasium',
  channel_url: 'https://www.youtube.com/@veritasium',
  subscriber_count: '16000000',
  total_videos: '3',
  avg_views: '2500000',
  format_type: 'monologue',
  language: 'en',
  country: 'US',
  description: 'Visual science education by Derek Muller — physics, engineering, surprising experiments',
  status: 'pending',
}

// Authored monologue transcripts (~400 words each). Plain talking-head voice so
// the analyst LLM has real material to reverse-engineer a persona from.
const DEMO_TRANSCRIPTS = [
  {
    video_id: 'DEMO_V1',
    video_title: 'Why Does Ice Float? The Strangest Liquid on Earth',
    text: `So here's something we just take for granted: ice floats. You drop a cube in your drink and it bobs right up to the top. But stop and think about that for a second, because it is genuinely bizarre. For almost every other substance on the planet, the solid form is denser than the liquid form. The solid sinks. Water does the exact opposite, and that one weird property is, I would argue, the reason you and I are alive to talk about it.

Let me show you what I mean. When most liquids cool down, the molecules slow, they pack in tighter, and the whole thing gets denser. Water does that too — right up until about four degrees Celsius. And then something strange happens. As it keeps cooling toward freezing, it starts to expand. The molecules actually push apart. The reason is hydrogen bonding. Each water molecule wants to hold its neighbors at this very particular angle, and when ice forms, that locks them into an open, hexagonal lattice with a bunch of empty space in it. More empty space means less density. Less density means it floats.

Now why does that matter? Imagine a lake in winter. If ice sank, the coldest water would freeze at the bottom and just stay there, and the lake would freeze solid from the bottom up, killing basically everything in it. Instead, the ice forms on top and acts like a blanket, insulating the liquid water underneath so fish, plants, the whole ecosystem, survive until spring. Life in cold climates depends on this one accident of molecular geometry.

And here's the part I love. This isn't some rare edge case — it's happening in your freezer, in every pond, in the polar ice caps, constantly. We are so used to it that it looks normal. But normal and obvious are not the same thing. The most interesting science is often hiding inside the stuff you stopped questioning years ago. So next time you see an ice cube float, just remember you're looking at one of the strangest and most important properties in all of chemistry.`,
  },
  {
    video_id: 'DEMO_V2',
    video_title: 'The Counterintuitive Physics of How Bikes Stay Up',
    text: `Ask ten people why a bicycle stays upright and you'll get the same answer almost every time: gyroscopic forces. The wheels are spinning, and spinning things resist tipping over, so the bike balances itself. It's a great answer. It's intuitive. And it's mostly wrong.

Here's how we know. Researchers built a special bicycle designed to cancel out the gyroscopic effect entirely — they added a second wheel spinning backwards, so the net gyroscopic force was zero. By the popular theory, this bike should have just fallen over. It didn't. You give it a push and it stays up and steers itself just fine. So whatever is keeping a bike balanced, it is not primarily the gyroscope.

So what is it? It turns out a moving bike is constantly, automatically steering into the direction it's falling. Lean a little to the left, and the front wheel turns a little to the left, which drives the wheels back underneath the center of mass and stands the bike back up. It's a self-correcting feedback loop, and a lot of it comes from the geometry of the front fork — the way the steering axis meets the ground slightly ahead of where the tire touches. That's called trail, and it makes the steering naturally fall into the turn.

And this is the thing I find genuinely humbling about physics. The explanation everybody confidently repeats — the one that feels obviously true — falls apart the moment you actually test it. Not because people are foolish, but because a story that sounds right is incredibly satisfying, and we rarely go back and check. The universe doesn't care how good your explanation sounds. It only cares whether it survives an experiment.

So the bike isn't balanced by some single magic force. It's a system — geometry, mass distribution, steering, speed — all working together, and even today engineers don't fully agree on the tidiest way to describe it. Which I think is wonderful. A machine a child can ride is still, at the level of the equations, an open question. That's the gap between knowing how to do something and knowing why it works, and that gap is where all the interesting science lives.`,
  },
  {
    video_id: 'DEMO_V3',
    video_title: 'Survivorship Bias: The Planes That Came Back',
    text: `During World War II, the American military had a problem. Their bombers were getting shot down, and they wanted to add armor to protect them. But armor is heavy, and you can't cover the whole plane, so the question was: where do you put it? So they did the sensible thing. They looked at the planes coming back from missions and mapped out every bullet hole. And the holes clustered in certain places — the wings, the tail, the body of the fuselage. The obvious conclusion: reinforce the areas with the most damage.

But a statistician named Abraham Wald looked at the exact same data and said, no — you've got it backwards. Put the armor where there are no bullet holes. And that sounds insane until you realize the critical thing they were missing. They were only looking at the planes that came back. The planes with holes in the engines, in the cockpit — those planes didn't make it home. They weren't in the data at all. So the undamaged areas on the survivors weren't safe to hit. They were the areas where, if you got hit, you didn't survive to be counted.

This is survivorship bias, and once you see it, you start noticing it everywhere. We study successful companies and try to copy their habits, forgetting all the companies that did the exact same things and failed silently. We read about the college dropout billionaire and conclude that dropping out works, ignoring the thousands who dropped out and just got poorer. The failures don't write memoirs. They drop out of the dataset, and so we draw confident conclusions from a sample that's been quietly filtered.

What I want you to take from this isn't just a clever wartime story. It's a habit of mind. Whenever someone shows you data and draws a conclusion, the most important question is often not "what does this show?" but "what's missing? Who or what isn't in this picture, and why?" The bullet holes you can see are seductive. The real signal is in the planes that never came back — the data you'll never get to look at. Learning to ask about the absent data is, honestly, one of the most powerful thinking tools there is.`,
  },
]

const out = `// AUTO-GENERATED by scripts/gen-seed.mjs — do not edit by hand.
// Inlines the repo reference CSVs + authored demo transcripts so the worker can
// seed a fully testable system offline. Regenerate with: node scripts/gen-seed.mjs
/* eslint-disable */

export const NICHES_CSV = ${JSON.stringify(nichesCsv)}

export const CHANNELS_CSV = ${JSON.stringify(channelsCsv)}

export const DEMO_NICHE = ${JSON.stringify(DEMO_NICHE, null, 2)}

export const DEMO_CHANNEL = ${JSON.stringify(DEMO_CHANNEL, null, 2)}

export interface DemoTranscript {
  video_id: string
  video_title: string
  text: string
}

export const DEMO_TRANSCRIPTS: DemoTranscript[] = ${JSON.stringify(DEMO_TRANSCRIPTS, null, 2)}
`

const target = resolve(appRoot, 'src', 'generated', 'seedData.ts')
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, out, 'utf8')
console.log(`Wrote ${target}`)
console.log(`  niches CSV:   ${nichesCsv.length} bytes`)
console.log(`  channels CSV: ${channelsCsv.length} bytes`)
console.log(`  demo transcripts: ${DEMO_TRANSCRIPTS.length}`)
