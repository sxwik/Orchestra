import { describe, it, expect } from 'vitest';
import { OrchestraCore } from '../src/core/OrchestraCore';
import { Container } from '../src/core/Container';
import { CapabilityRegistry } from '../src/core/CapabilityRegistry';
import { EventBus } from '../src/core/EventBus';
import { OrchestraPlugin } from '../src/types';
import { performance } from 'perf_hooks';

describe('Orchestra Benchmarks', () => {
  it('measures plugin registration and container resolution latency', () => {
    const app = new OrchestraCore();
    
    const startRegister = performance.now();
    for (let i = 0; i < 100; i++) {
      const dummyPlugin: OrchestraPlugin = {
        name: `dummy-plugin-${i}`,
        version: '1.0.0',
        install(kernel: any) {
          const capRegistry = kernel.container.resolve<CapabilityRegistry>('capabilityRegistry');
          capRegistry.register('chat', {
            name: `dummy-provider-${i}`,
            async chat(prompt: string) {
              return { text: `dummy-${i}`, model: 'dummy', provider: `dummy-${i}` };
            }
          });
        }
      };
      app.use(dummyPlugin);
    }
    const endRegister = performance.now();
    const registerOverheadMs = (endRegister - startRegister) / 100;
    
    console.log(`[BENCHMARK] Average plugin registration speed: ${registerOverheadMs.toFixed(4)} ms`);
    expect(registerOverheadMs).toBeLessThan(1.0);
    
    const container = app.container;
    const startResolve = performance.now();
    for (let i = 0; i < 10000; i++) {
      container.resolve('capabilityRegistry');
    }
    const endResolve = performance.now();
    const resolveOverheadMs = (endResolve - startResolve) / 10000;
    
    console.log(`[BENCHMARK] Average DI container resolution latency: ${resolveOverheadMs.toFixed(5)} ms`);
    expect(resolveOverheadMs).toBeLessThan(0.05);
  });

  it('measures event bus emit overhead', async () => {
    const eventBus = new EventBus();
    let counter = 0;
    
    eventBus.on('test-event', () => {
      counter++;
    });
    
    const startEmit = performance.now();
    for (let i = 0; i < 1000; i++) {
      await eventBus.emit('test-event', i);
    }
    const endEmit = performance.now();
    const emitOverheadMs = (endEmit - startEmit) / 1000;
    
    console.log(`[BENCHMARK] Average event emission overhead: ${emitOverheadMs.toFixed(4)} ms`);
    expect(emitOverheadMs).toBeLessThan(0.5);
    expect(counter).toBe(1000);
  });
});
