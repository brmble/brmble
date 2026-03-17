# Data Theme Design

## Overview
Transform the idle game from a farm simulator to a data hosting empire. Players buy infrastructure to gain bandwidth, then offer services to monetize it.

## Game Loop
```
Buy Infrastructure → Gain Bandwidth → Host Services → Earn Money → Buy More Infrastructure
```

## Changes from Farm Theme

| Farm Concept | Data Theme |
|--------------|------------|
| Crops | Infrastructure |
| Income ($/s) | Bandwidth (KB/s → TB/s) |
| Soil/Fertilizer/Seeds | Tech Upgrades (+25% each) |
| — | Services tab |
| — | Bandwidth allocation |

## Tab Structure

### Infrastructure Tab
- Replaces "Crops" tab
- Columns: INFRASTRUCTURE, COST, OWNED, UPLOAD, UPGRADE, BUY
- Same mechanics as current crops (exponential cost scaling, owned count)
- Upload displayed with unit suffixes (KB/s, MB/s, GB/s, TB/s)

### Tech Upgrades Tab
- Replaces current upgrade system (Soil/Fertilizer/Seeds)
- 11 tech upgrades, each +25% bandwidth
- Same upgrade button behavior as current system
- Upgrade names:
  1. Better Cooling
  2. Heat Sink Array
  3. High-Speed Modem
  4. Water Cooling
  5. Fiber Backbone
  6. Signal Booster
  7. Multi-Threaded Uplink
  8. Packet Optimizer
  9. AI Packet Routing
  10. Turbo Upload Core
- Max level per upgrade type: 10 (consistent with current soil/fertilizer)

### Hosting Tab (New)
- **Automatic Services** (always active if bandwidth available):
  - Personal Website (1 KB/s → $1/s) — unlocked at start
  - Blog Hosting (5 KB/s → $4/s) — unlocked at $100
  - File Hosting (20 KB/s → $15/s) — unlocked at $500

- **Manual Services** (player activates/deactivates):
  | Service | Bandwidth Required | Income |
  |---------|-------------------|--------|
  | Video Streaming | 100 KB/s | $90/sec |
  | Game Downloads | 1 MB/s | $900/sec |
  | Cloud Storage | 10 MB/s | $8,000/sec |
  | Live Streaming Platform | 50 MB/s | $40,000/sec |
  | Video CDN | 200 MB/s | $180,000/sec |
  | Multiplayer Game Servers | 1 GB/s | $900,000/sec |
  | AI Model Hosting | 5 GB/s | $4,500,000/sec |
  | Global CDN Network | 20 GB/s | $18,000,000/sec |
  | AI Training Data Pipeline | 100 GB/s | $90,000,000/sec |

### Options Tab
- Unchanged from current implementation

## Resource Panel (Header)

Display format:
```
Money: $14,520    Upload: 3.4 MB/s    Sold: 12.8 GB    Income: $34/s
```

- **Money**: Current balance
- **Upload**: Total bandwidth from all infrastructure (with upgrades applied)
- **Sold**: Total bandwidth consumed by active services
- **Income**: Total money generated per second

## Initial State
- Start money: $20
- USB Uploader unlocked (1 KB/s)
- Home Server unlocked (8 KB/s)
- Personal Website service active (automatic)
- All other services locked until bandwidth/money threshold met

## Infrastructure Data

| Infrastructure | Upload/sec | Base Cost | Unlock Requirement |
|----------------|------------|-----------|---------------------|
| USB Uploader | 1 KB/s | $10 | Starting |
| Home Server | 8 KB/s | $100 | Starting |
| Server Rack | 47 KB/s | $1,100 | $5,000 |
| Server Room | 260 KB/s | $12,000 | $50,000 |
| Small Data Center | 2 MB/s | $130,000 | $500,000 |
| Data Center Hall | 15 MB/s | $1,400,000 | $5,000,000 |
| Mega Data Center | 120 MB/s | $20,000,000 | $75,000,000 |
| Hyperscale Data Center | 600 MB/s | $330,000,000 | $1,000,000,000 |
| Global Network Hub | 4 GB/s | $5,100,000,000 | $15,000,000,000 |
| Satellite Uplink | 25 GB/s | $75,000,000,000 | $200,000,000,000 |
| Orbital Data Center | 160 GB/s | $1,000,000,000,000 | $5,000,000,000,000 |
| Quantum Server Grid | 1 TB/s | $14,000,000,000,000 | $50,000,000,000,000 |
| Planetary Internet | 7 TB/s | $170,000,000,000,000 | $500,000,000,000,000 |

## Tech Upgrade Costs
- Base cost: $50 (scaled per upgrade type)
- Cost scaling: 1.5x per level (same as current)

## Save Migration
- Existing saves will be reset (no migration needed)
- Storage key remains: `idle-farm-save`

## Implementation Priority
1. Update types (Infrastructure, Service interfaces)
2. Infrastructure tab (rename crops → infrastructure)
3. Tech upgrades tab (replace soil/fertilizer/seeds)
4. Services tab (automatic + manual services)
5. Header (add Upload/Sold displays)
6. Game loop (bandwidth → services → income)
