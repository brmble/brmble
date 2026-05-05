import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Zap, Info, RotateCcw, Cpu, User, AlertCircle } from 'lucide-react';

// --- Types ---
type Move = 'rock' | 'paper' | 'scissors';

interface ParticipantState {
  rock: number;
  paper: number;
  scissors: number;
  score: number;
}

const MOVES: Record<Move, { icon: string; beats: Move; label: string; color: string }> = {
  rock: { icon: '🪨', beats: 'scissors', label: 'Rock', color: 'text-blue-400' },
  paper: { icon: '📄', beats: 'rock', label: 'Paper', color: 'text-emerald-400' },
  scissors: { icon: '✂️', beats: 'paper', label: 'Scissors', color: 'text-amber-400' },
};

const App: React.FC = () => {
  // --- State ---
  const [player, setPlayer] = useState<ParticipantState>({ rock: 3, paper: 3, scissors: 3, score: 0 });
  const [cpu, setCpu] = useState<ParticipantState>({ rock: 3, paper: 3, scissors: 3, score: 0 });
  const [battle, setBattle] = useState<{ active: boolean; pMove?: Move; cMove?: Move; stage: 'counting' | 'reveal' | 'idle' }>({
    active: false,
    stage: 'idle'
  });
  const [logs, setLogs] = useState<string[]>(['System online. Awaiting input...']);
  const [gameOver, setGameOver] = useState(false);

  // --- AI Logic ---
  const getCPUMove = useCallback((): Move => {
    const available = (Object.keys(MOVES) as Move[]).filter(m => cpu[m] > 0);
    
    // Strategic analysis
    const playerOutOfRock = player.rock === 0;
    const playerOutOfPaper = player.paper === 0;
    const playerOutOfScissors = player.scissors === 0;

    // 1. Safety check: can I play an unbeatable move?
    if (playerOutOfPaper && available.includes('rock')) return 'rock';
    if (playerOutOfScissors && available.includes('paper')) return 'paper';
    if (playerOutOfRock && available.includes('scissors')) return 'scissors';

    // 2. Counter-logic: what does the player have the most of?
    const pStrongest = (Object.keys(MOVES) as Move[]).sort((a, b) => player[b] - player[a])[0];
    const counter = (Object.keys(MOVES) as Move[]).find(m => MOVES[m].beats === pStrongest);

    if (counter && available.includes(counter) && Math.random() > 0.3) {
      return counter;
    }

    // 3. Random fallback
    return available[Math.floor(Math.random() * available.length)];
  }, [cpu, player]);

  const addLog = (msg: string) => {
    setLogs(prev => [msg, ...prev].slice(0, 5));
  };

  // --- Battle Execution ---
  const startDuel = async (move: Move) => {
    if (battle.active || player[move] <= 0 || gameOver) return;

    const cpuMove = getCPUMove();
    setBattle({ active: true, pMove: move, cMove: cpuMove, stage: 'counting' });
    
    // Deduct budget immediately
    setPlayer(prev => ({ ...prev, [move]: prev[move] - 1 }));
    setCpu(prev => ({ ...prev, [cpuMove]: prev[cpuMove] - 1 }));

    // Fake delay for tension
    await new Promise(r => setTimeout(r, 1200));
    setBattle(prev => ({ ...prev, stage: 'reveal' }));

    // Process result
    setTimeout(() => {
      let resultMsg = "";
      if (move === cpuMove) {
        resultMsg = "Draw! System sync detected.";
      } else if (MOVES[move].beats === cpuMove) {
        resultMsg = "Victory! Target neutralized.";
        setPlayer(prev => ({ ...prev, score: prev.score + 1 }));
      } else {
        resultMsg = "System Error! CPU override successful.";
        setCpu(prev => ({ ...prev, score: prev.score + 1 }));
      }
      addLog(resultMsg);
    }, 200);

    // Reset for next round or end game
    await new Promise(r => setTimeout(r, 2000));
    
    const remainingMoves = player.rock + player.paper + player.scissors + cpu.rock + cpu.paper + cpu.scissors;
    // Game ends when 9 total rounds are played (initial budget was 3+3+3 per player)
    if (remainingMoves === 0) {
      setGameOver(true);
    } else {
      setBattle({ active: false, stage: 'idle' });
    }
  };

  const resetGame = () => {
    setPlayer({ rock: 3, paper: 3, scissors: 3, score: 0 });
    setCpu({ rock: 3, paper: 3, scissors: 3, score: 0 });
    setBattle({ active: false, stage: 'idle' });
    setGameOver(false);
    setLogs(['System rebooted. Good luck, operator.']);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8 flex flex-col items-center justify-center font-sans">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* PLAYER SIDE */}
        <div className="lg:col-span-3 space-y-6 order-2 lg:order-1">
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-blue-400 font-bold">Operator</p>
                <h2 className="text-xl font-black italic">USER_01</h2>
              </div>
              <div className="text-3xl font-black text-blue-500">{player.score}</div>
            </div>

            <div className="space-y-4">
              {(Object.keys(MOVES) as Move[]).map(type => (
                <button
                  key={type}
                  disabled={player[type] === 0 || battle.active}
                  onClick={() => startDuel(type)}
                  className={`w-full p-4 rounded-2xl border transition-all duration-300 flex items-center justify-between group
                    ${player[type] > 0 
                      ? 'bg-slate-800/40 border-slate-700 hover:border-blue-500 hover:bg-slate-800' 
                      : 'opacity-20 grayscale cursor-not-allowed border-transparent'}
                    ${battle.pMove === type && battle.active ? 'ring-2 ring-blue-500 bg-blue-500/10' : ''}
                  `}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl group-hover:scale-110 transition-transform">{MOVES[type].icon}</span>
                    <span className="text-xs uppercase font-bold tracking-tighter">{MOVES[type].label}</span>
                  </div>
                  <div className="flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`w-2 h-4 rounded-sm transition-colors ${i < player[type] ? 'bg-blue-500' : 'bg-slate-700'}`}
                      />
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ARENA */}
        <div className="lg:col-span-6 flex flex-col items-center gap-8 order-1 lg:order-2">
          <div className="text-center">
            <h1 className="text-4xl font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-slate-500 mb-1 uppercase italic">
              Budget Duel
            </h1>
            <div className="h-1 w-24 bg-blue-500 mx-auto rounded-full blur-[1px]"></div>
          </div>

          <div className={`relative w-full aspect-square max-w-[400px] rounded-full border-2 flex items-center justify-center overflow-hidden transition-colors duration-500
            ${battle.stage === 'reveal' ? 'bg-slate-900 border-blue-500/50' : 'bg-slate-900/30 border-slate-800'}
          `}>
            {/* Visual Flair */}
            <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-blue-500 via-transparent to-transparent"></div>

            {!battle.active && !gameOver && (
              <div className="text-center p-8 animate-pulse">
                <Shield className="w-12 h-12 mx-auto mb-4 text-slate-700" />
                <p className="text-slate-500 text-sm font-medium uppercase tracking-widest leading-relaxed">
                  Select a symbol<br/>to initiate attack
                </p>
              </div>
            )}

            {battle.active && (
              <div className="flex items-center justify-around w-full px-8">
                {/* Player Choice */}
                <div className={`transition-all duration-500 flex flex-col items-center ${battle.stage === 'reveal' ? 'opacity-100 translate-x-0' : 'opacity-40 -translate-x-12'}`}>
                  <span className="text-8xl">{battle.stage === 'reveal' ? MOVES[battle.pMove!].icon : '❓'}</span>
                  <p className="mt-4 text-[10px] font-bold text-blue-400 uppercase">Your Play</p>
                </div>

                <div className="text-2xl font-black italic text-slate-700">VS</div>

                {/* CPU Choice */}
                <div className={`transition-all duration-500 flex flex-col items-center ${battle.stage === 'reveal' ? 'opacity-100 translate-x-0' : 'opacity-40 translate-x-12'}`}>
                  <span className="text-8xl">{battle.stage === 'reveal' ? MOVES[battle.cMove!].icon : '❓'}</span>
                  <p className="mt-4 text-[10px] font-bold text-rose-500 uppercase">CPU Play</p>
                </div>
              </div>
            )}

            {battle.stage === 'counting' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                <div className="text-4xl font-black italic animate-ping">ANALYSIS...</div>
              </div>
            )}

            {gameOver && (
              <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center z-10">
                <h3 className={`text-5xl font-black italic mb-2 ${player.score > cpu.score ? 'text-blue-400' : 'text-rose-500'}`}>
                  {player.score > cpu.score ? 'VICTORY' : player.score < cpu.score ? 'DEFEATED' : 'STALEMATE'}
                </h3>
                <p className="text-slate-400 mb-8 max-w-[250px]">Duel terminated. All budgets exhausted.</p>
                <button 
                  onClick={resetGame}
                  className="px-8 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-bold flex items-center gap-2 transition-transform active:scale-95"
                >
                  <RotateCcw className="w-4 h-4" /> REBOOT SYSTEM
                </button>
              </div>
            )}
          </div>

          <div className="w-full max-w-[400px] h-16 flex flex-col items-center justify-center">
            <div className="flex gap-2 mb-2">
              {[...Array(9)].map((_, i) => (
                <div 
                  key={i} 
                  className={`h-1 w-6 rounded-full transition-colors ${i < (9 - (player.rock + player.paper + player.scissors + cpu.rock + cpu.paper + cpu.scissors)/2) ? 'bg-blue-500' : 'bg-slate-800'}`}
                />
              ))}
            </div>
            <p className="text-[10px] uppercase font-bold tracking-widest text-slate-600">Round Progress</p>
          </div>
        </div>

        {/* CPU SIDE */}
        <div className="lg:col-span-3 space-y-6 order-3">
          <div className="bg-slate-900/50 border border-slate-800 p-6 rounded-3xl backdrop-blur-md">
            <div className="flex items-center justify-between mb-8">
              <div>
                <p className="text-[10px] uppercase tracking-widest text-rose-500 font-bold">Threat level: High</p>
                <h2 className="text-xl font-black italic">A.I. UNIT</h2>
              </div>
              <div className="text-3xl font-black text-rose-500">{cpu.score}</div>
            </div>

            <div className="space-y-6">
              {(Object.keys(MOVES) as Move[]).map(type => (
                <div key={type} className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-bold text-slate-500 uppercase">{MOVES[type].label}</span>
                    <span className="text-[10px] font-mono text-slate-400">{cpu[type]}/3</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-rose-500 transition-all duration-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]" 
                      style={{ width: `${(cpu[type] / 3) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-10 p-4 bg-black/40 rounded-2xl border border-slate-800/50">
              <div className="flex items-center gap-2 mb-3 border-b border-slate-800 pb-2">
                <Cpu className="w-3 h-3 text-emerald-400" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">AI Logbook</span>
              </div>
              <div className="space-y-2">
                {logs.map((log, i) => (
                  <div key={i} className={`text-[10px] font-mono leading-tight ${i === 0 ? 'text-blue-400' : 'text-slate-600'}`}>
                    {`> ${log}`}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 bg-blue-500/5 border border-blue-500/20 rounded-2xl">
            <AlertCircle className="w-5 h-5 text-blue-400 shrink-0" />
            <p className="text-[10px] leading-relaxed text-slate-400">
              <strong className="text-blue-300">TIPS:</strong> The AI analyzes your remaining supply. If you are out of Paper, the AI will use Rock more often as it becomes unbeatable.
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default App;