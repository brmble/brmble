# Advertisement System Design

## Core Concept

Each license (Personal Website, Blog Hosting, etc.) has KB/s capacity. You can place ads on licenses. An ad takes X KB/s from that license's capacity. The remaining KB/s continues as normal hosting. The ad sells its X KB/s at a higher rate (based on Margin).

## Ad Properties

- **Volume** (1-5 stars): How much bandwidth the ad consumes
- **Margin** (1-5 stars): Multiplier on money per KB/s
- Each ad has a randomly generated name

## Slots

- 1 free slot to start
- Buy more in Tech Upgrades tab

## Refresh Mechanic

- Manual "Find New Ad" button
- Cooldown: 5 minutes between refreshes
- New ad: random Volume + Margin (1-5 stars each)
- Can replace current ad with new one

## UI - Hosting Tab

- Top section shows all ad slots
- Each slot shows: ad name, Volume/Margin stars, assigned license
- Click to assign which license the ad runs on

## Example

- Personal Website: 20 KB/s capacity
- Ad with Volume 3, Margin 4 stars
- Ad uses 3 KB/s → sells at 4x rate
- 17 KB/s remains for regular hosting at normal rate
