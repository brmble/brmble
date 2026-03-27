import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGameState } from './useGameState';
import { ProfileProvider } from '../../contexts/ProfileContext';
import React from 'react';

vi.useFakeTimers();

const wrapper = ({ children }: { children?: React.ReactNode }) => (
  React.createElement(ProfileProvider, { value: 'test-fingerprint' }, children)
);

describe('useGameState', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllTimers();
  });

  describe('income ticker interval', () => {
    it('does not recreate interval when unrelated derived values change', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      
      const initialMoney = result.current.state.money;
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', 512);
      });
      
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      
      expect(result.current.state.money).toBe(initialMoney + result.current.state.incomePerSecond);
    });
  });

  describe('unlockLicense', () => {
    it('unlocks a license when player has enough money', () => {
      localStorage.setItem('idle-farm-save_test-fingerprint', JSON.stringify({
        money: 200,
        incomePerSecond: 0,
        uploadSpeed: 0,
        bandwidthAllocated: 0,
        infrastructure: [],
        licenses: [
          { id: 'personal-website', name: 'Personal Website', unlocked: true, level: 0, allocated: 0, unlockCost: 0, baseCap: 1024, capPerLevel: 1024, incomePerKB: 0.001, baseUpgradeCost: 10 },
          { id: 'blog-hosting', name: 'Blog Hosting', unlocked: false, level: 0, allocated: 0, unlockCost: 100, baseCap: 5120, capPerLevel: 10240, incomePerKB: 0.0005, baseUpgradeCost: 100 },
        ],
        lastSaved: Date.now(),
      }));
      
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.unlockLicense('blog-hosting');
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      expect(license?.unlocked).toBe(true);
      expect(result.current.state.money).toBe(200 - 100);
    });

    it('does not unlock a license when player has insufficient money', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.unlockLicense('video-streaming');
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'video-streaming');
      expect(license?.unlocked).toBe(false);
      expect(result.current.state.money).toBe(20);
    });

    it('does not unlock an already unlocked license', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      const initialMoney = result.current.state.money;
      
      act(() => {
        result.current.actions.unlockLicense('personal-website');
      });
      
      expect(result.current.state.money).toBe(initialMoney);
    });
  });

  describe('upgradeLicense', () => {
    it('upgrades a license when player has enough money', () => {
      localStorage.setItem('idle-farm-save_test-fingerprint', JSON.stringify({
        money: 200,
        incomePerSecond: 0,
        uploadSpeed: 0,
        bandwidthAllocated: 0,
        infrastructure: [],
        licenses: [
          { id: 'personal-website', name: 'Personal Website', unlocked: true, level: 0, allocated: 0, unlockCost: 0, baseCap: 1024, capPerLevel: 1024, incomePerKB: 0.001, baseUpgradeCost: 10 },
          { id: 'blog-hosting', name: 'Blog Hosting', unlocked: true, level: 0, allocated: 0, unlockCost: 100, baseCap: 5120, capPerLevel: 10240, incomePerKB: 0.0005, baseUpgradeCost: 100 },
        ],
        lastSaved: Date.now(),
      }));
      
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.upgradeLicense('blog-hosting');
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      expect(license?.level).toBe(1);
    });

    it('does not upgrade a locked license', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.upgradeLicense('blog-hosting');
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      expect(license?.level).toBe(0);
    });

    it('does not upgrade when player has insufficient money', () => {
      localStorage.setItem('idle-farm-save_test-fingerprint', JSON.stringify({
        money: 50,
        incomePerSecond: 0,
        uploadSpeed: 0,
        bandwidthAllocated: 0,
        infrastructure: [],
        licenses: [
          { id: 'personal-website', name: 'Personal Website', unlocked: true, level: 0, allocated: 0, unlockCost: 0, baseCap: 1024, capPerLevel: 1024, incomePerKB: 0.001, baseUpgradeCost: 10 },
          { id: 'blog-hosting', name: 'Blog Hosting', unlocked: true, level: 0, allocated: 0, unlockCost: 100, baseCap: 5120, capPerLevel: 10240, incomePerKB: 0.0005, baseUpgradeCost: 100 },
        ],
        lastSaved: Date.now(),
      }));
      
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      const initialMoney = result.current.state.money;
      
      act(() => {
        result.current.actions.upgradeLicense('blog-hosting');
      });
      
      expect(result.current.state.money).toBe(initialMoney);
    });

    it('caps upgrade at level 10', () => {
      localStorage.setItem('idle-farm-save_test-fingerprint', JSON.stringify({
        money: 100000,
        incomePerSecond: 0,
        uploadSpeed: 0,
        bandwidthAllocated: 0,
        infrastructure: [],
        licenses: [
          { id: 'personal-website', name: 'Personal Website', unlocked: true, level: 0, allocated: 0, unlockCost: 0, baseCap: 1024, capPerLevel: 1024, incomePerKB: 0.001, baseUpgradeCost: 10 },
          { id: 'blog-hosting', name: 'Blog Hosting', unlocked: true, level: 0, allocated: 0, unlockCost: 100, baseCap: 5120, capPerLevel: 10240, incomePerKB: 0.0005, baseUpgradeCost: 100 },
        ],
        lastSaved: Date.now(),
      }));
      
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      for (let i = 0; i < 15; i++) {
        act(() => {
          result.current.actions.upgradeLicense('blog-hosting');
        });
      }
      
      const license = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      expect(license?.level).toBe(10);
    });
  });

  describe('allocateBandwidth', () => {
    it('allocates bandwidth to an unlocked license when upload speed available', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', 512);
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'personal-website');
      expect(license?.allocated).toBe(512);
    });

    it('does not allocate bandwidth to a locked license', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('blog-hosting', 1000);
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      expect(license?.allocated).toBe(0);
    });

    it('limits allocation by license cap', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'personal-website');
      const cap = license!.baseCap + (license!.level * license!.capPerLevel);
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', cap + 10000);
      });
      
      const updatedLicense = result.current.state.licenses.find(l => l.id === 'personal-website');
      expect(updatedLicense?.allocated).toBe(cap);
    });

    it('limits total allocation by upload speed across multiple licenses', () => {
      localStorage.setItem('idle-farm-save_test-fingerprint', JSON.stringify({
        money: 200,
        incomePerSecond: 0,
        uploadSpeed: 0,
        bandwidthAllocated: 0,
        infrastructure: [],
        licenses: [
          { id: 'personal-website', name: 'Personal Website', unlocked: true, level: 0, allocated: 0, unlockCost: 0, baseCap: 1024, capPerLevel: 1024, incomePerKB: 0.001, baseUpgradeCost: 10 },
          { id: 'blog-hosting', name: 'Blog Hosting', unlocked: true, level: 0, allocated: 0, unlockCost: 100, baseCap: 5120, capPerLevel: 10240, incomePerKB: 0.0005, baseUpgradeCost: 100 },
        ],
        lastSaved: Date.now(),
      }));
      
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', 800);
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('blog-hosting', 800);
      });
      
      const personalWebsite = result.current.state.licenses.find(l => l.id === 'personal-website');
      const blogHosting = result.current.state.licenses.find(l => l.id === 'blog-hosting');
      
      expect(personalWebsite?.allocated + blogHosting?.allocated).toBeLessThanOrEqual(1024);
    });

    it('allows allocation up to upload speed', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', 0);
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', 500);
      });
      
      const updatedLicense = result.current.state.licenses.find(l => l.id === 'personal-website');
      expect(updatedLicense?.allocated).toBe(500);
    });

    it('clamps negative allocation to 0', () => {
      const { result } = renderHook(() => useGameState(), { wrapper });
      
      act(() => {
        result.current.actions.buyInfrastructure('usb');
      });
      
      act(() => {
        result.current.actions.allocateBandwidth('personal-website', -100);
      });
      
      const license = result.current.state.licenses.find(l => l.id === 'personal-website');
      expect(license?.allocated).toBe(0);
    });
  });
});
