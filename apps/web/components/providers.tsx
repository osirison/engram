'use client';

import * as React from 'react';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TRPCProvider } from '@/trpc/react';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TRPCProvider>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster position="bottom-right" />
      </TRPCProvider>
    </ThemeProvider>
  );
}
