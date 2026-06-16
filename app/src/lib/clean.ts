/**
 * Stage 1: Minimal Cleaning
 * Applied IMMEDIATELY after extracting from Apify, before saving to the database.
 * Safe, non-destructive formatting.
 */
export function minimalClean(text: string): string {
  let cleaned = text

  // 1. Remove standard timestamps: [00:15:32] or (15:32)
  cleaned = cleaned.replace(/\[\d{2}:\d{2}:\d{2}\]/g, '')
  cleaned = cleaned.replace(/\(\d{1,2}:\d{2}\)/g, '')

  // 2. Remove standard YouTube bracketed noise: [Music], [Applause]
  cleaned = cleaned.replace(/\[.*?\]/g, '')

  // 3. Fix control characters (invisible junk data)
  cleaned = cleaned.replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, '')

  // 4. Normalize whitespace and fix punctuation spacing
  cleaned = cleaned.replace(/\s+/g, ' ')
  cleaned = cleaned.replace(/\s+([?.!,])/g, '$1')

  return cleaned.trim()
}

export interface CleanMetrics {
  originalLength: number
  cleanedLength: number
  reductionPercent: number
}

/**
 * Stage 2: Deep Cleaning
 * Applied BEFORE embedding and chunking. 
 * Aggressively removes fillers, CTAs, and noise based on the niche.
 */
export function deepClean(text: string, nicheId: string | null): { text: string; metrics: CleanMetrics } {
  const originalLength = text.length
  let cleaned = text

  // 1. Remove Speaker Tags. Restricted to explicit speaker/role labels so it
  //    no longer eats normal sentence openers like "Note:", "Today:", "Tip:".
  //    (The old /^(?:[A-Z][a-zA-Z0-9]*\s?)+:\s/ matched any capitalized word(s)
  //    + colon, which stripped real content; bare "John:" name tags are rare in
  //    single-speaker monologue transcripts and not worth that risk.)
  cleaned = cleaned.replace(
    /^(speaker\s*\d+|interviewer|interviewee|host|guest|moderator|narrator|audience|q|a|question|answer)\s*:\s/gim,
    '',
  )

  // Define Niche Categories based on ID ranges
  const isFinance = nicheId ? /^N00[1-8]/.test(nicheId) : false
  const isBusiness = nicheId ? /^N0(2[0-9]|30)/.test(nicheId) : false
  const isHealth = nicheId ? /^N0(3[1-9]|4[0-9])/.test(nicheId) : false
  const isEducation = nicheId ? /^N05[0-6]/.test(nicheId) : false
  const isPsychology = nicheId ? /^N06[5-9]/.test(nicheId) : false

  // 2. Remove Sponsors (Aggressive for Finance)
  if (isFinance) {
    const financeSponsorRegex = /\b(this video is sponsored by|click the link below to get your free stock|use my promo code|sign up for webull|brought to you by)\b.*?(?=\.|\n|$)/gi
    cleaned = cleaned.replace(financeSponsorRegex, '')
    // Finance specifically: Remove heavy affiliate links/URLs
    cleaned = cleaned.replace(/https?:\/\/\S+/gi, '')
  } else if (!isEducation) {
    const genericSponsorRegex = /\b(this video is sponsored by|quick shoutout to our sponsor)\b.*?(?=\.|\n|$)/gi
    cleaned = cleaned.replace(genericSponsorRegex, '')
  }

  // 3. Remove standard Calls To Action (CTAs) - Varies by niche
  if (isBusiness) {
    // Maximum CTA removal for Business domain
    const maxCtaRegex = /\b(smash that like button|hit subscribe|link in the description|subscribe to the channel|leave a comment|ring the bell|turn on notifications)\b/gi
    cleaned = cleaned.replace(maxCtaRegex, '')
  } else if (!isEducation) {
    const ctaRegex = /\b(smash that like button|hit subscribe|link in the description|subscribe to the channel|leave a comment)\b/gi
    cleaned = cleaned.replace(ctaRegex, '')
  }

  // 4. Niche-Aware Filler Removal.
  //    Only true disfluencies are removed. "like" and "just" are NOT stripped —
  //    they are ordinary content words ("stocks I like", "I just bought"), and
  //    deleting them corrupts meaning. (Previously removed for non-tech niches.)
  if (!isPsychology) {
    cleaned = cleaned.replace(/\b(um|uh|mhm|ah|you know)\b/gi, '')
  }

  // 5. Final safety cleanup for double spaces created by word removals
  cleaned = cleaned.replace(/\s+/g, ' ')
  cleaned = cleaned.replace(/\s+([?.!,])/g, '$1')
  
  cleaned = cleaned.trim()

  const cleanedLength = cleaned.length
  const reductionPercent = originalLength > 0 ? Number(((originalLength - cleanedLength) / originalLength * 100).toFixed(2)) : 0

  return {
    text: cleaned,
    metrics: { originalLength, cleanedLength, reductionPercent }
  }
}