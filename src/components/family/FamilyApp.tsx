import { useEffect, useState } from 'react';
import { alwaysAllowGateCovers } from '../../lib/alwaysAllowGate.mjs';
import { bindAndroidBack } from '../../platform/androidExit';
import { umapLocationNative } from '../../services/umapLocation';
import { AlwaysAllowGate } from './AlwaysAllowGate';
import { FamilyMapScreen } from './FamilyMapScreen';
import { Onboarding } from './Onboarding';
import { FamilyProvider, useFamily } from './session';

function FamilyRouter() {
  const { state } = useFamily();
  const gate = umapLocationNative() && alwaysAllowGateCovers(state.stage);
  return (
    <>
      {state.stage === 'map' ? <FamilyMapScreen /> : <Onboarding />}
      {gate ? <AlwaysAllowGate /> : null}
    </>
  );
}

function AndroidExitToast() {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => bindAndroidBack(setText), []);
  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(() => setText(null), 2000);
    return () => window.clearTimeout(timer);
  }, [text]);
  if (!text) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-10 z-[80] flex justify-center px-6" role="status">
      <p className="rounded-full bg-slate-900/90 px-4 py-2 text-center text-sm font-bold text-white shadow-lg">{text}</p>
    </div>
  );
}

export function FamilyApp() {
  return (
    <FamilyProvider>
      <FamilyRouter />
      <AndroidExitToast />
    </FamilyProvider>
  );
}
