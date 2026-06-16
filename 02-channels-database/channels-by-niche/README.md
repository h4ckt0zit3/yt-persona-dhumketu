# Channels by Niche

Each CSV file in this directory contains the top 100 channels for a specific niche.

## File Naming Convention
`{niche_id}_{niche_name}.csv` - e.g., `N001_personal_finance_budgeting.csv`

## CSV Schema
Same as `channels-master.csv` - all files feed into the master sheet.

## Population Method
1. Use YouTube Data API / Apify YouTube scraper to search by niche keywords
2. Filter for channels with monologue/talking-head format
3. Rank by subscriber count, engagement rate, and content consistency
4. Manual review for persona suitability
5. Add to niche-specific CSV and merge into master
