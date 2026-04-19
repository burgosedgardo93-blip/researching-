import { forwardRef } from 'react';
import { EffectComposer, Bloom, N8AO } from '@react-three/postprocessing';
import { KernelSize } from 'postprocessing';
import type { GaeaParamsRef } from '../gaea/gaeaParams';
import { useWorldStore } from '../state/worldStore';

interface PostFXStackProps {
  gaeaRef: GaeaParamsRef;
}

const PostFXStack = forwardRef<any, PostFXStackProps>(function PostFXStack(
  { gaeaRef },
  bloomRef,
) {
  const perf = gaeaRef.current.performanceMode;
  const draft = gaeaRef.current.draftMode;
  // Subscribed (not ref-read) so the composer mounts / unmounts reactively
  // when the user flips the View Mode toggle in the Leva panel.
  const studio = useWorldStore(s => s.viewMode === 'STUDIO');

  // Studio Mode also bypasses the composer entirely — sculpting needs the
  // razor-sharp forward pass, and Bloom + SSAO are the heaviest fixed cost.
  if (draft || studio) return null;

  // Performance Mode skips N8AO entirely; we branch to satisfy
  // EffectComposer's strict ReactElement child typing.
  if (perf) {
    return (
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom
          ref={bloomRef}
          intensity={0.32}
          luminanceThreshold={0.82}
          kernelSize={KernelSize.SMALL}
          mipmapBlur
        />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer enableNormalPass multisampling={4}>
      <N8AO intensity={1.4} aoRadius={1.2} />
      <Bloom
        ref={bloomRef}
        intensity={0.32}
        luminanceThreshold={0.82}
        kernelSize={KernelSize.LARGE}
        mipmapBlur
      />
    </EffectComposer>
  );
});

export default PostFXStack;
