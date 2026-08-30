/**
 * Enforces the effect creation ordering contract: adaptation cannot inspect
 * the active plugin until the build promise has fully resolved.
 */
export async function buildThenAdaptEffect<TPlugin, TResult>(
  build: () => Promise<void>,
  getActivePlugin: () => TPlugin | undefined,
  adapt: (plugin: TPlugin | undefined) => Promise<TResult>,
): Promise<TResult> {
  const pluginBeforeBuild = getActivePlugin();
  await build();
  const pluginAfterBuild = getActivePlugin();
  // A resolved chat/build request is not itself proof that a plugin artifact
  // was produced. Only a newly saved object may be adapted; otherwise the
  // caller gets `undefined` and must create a clearly non-adapted project.
  return adapt(pluginAfterBuild !== pluginBeforeBuild ? pluginAfterBuild : undefined);
}