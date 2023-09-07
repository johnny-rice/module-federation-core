import  type { Compiler, Compilation, Chunk, NormalModule } from 'webpack';

class DelegateModulesPlugin {
  options: { debug: boolean; [key: string]: any };
  _delegateModules: Map<string, NormalModule>;

  constructor(options: { debug?: boolean; [key: string]: any }) {
    this.options = { debug: false, ...options };
    this._delegateModules = new Map();
  }

  getChunkByName(chunks: Iterable<Chunk>, name: string): Chunk | undefined {
    for (let chunk of chunks) {
      if (chunk.name === name) {
        return chunk;
      }
    }
    return undefined;
  }

  private addDelegatesToChunks(
    compilation: Compilation,
    chunks: Iterable<Chunk>
  ): void {
    for (let chunk of chunks) {
      this._delegateModules.forEach(module => {
        this.addModuleAndDependenciesToChunk(module, chunk, compilation);
      });
    }
  }

  private addModuleAndDependenciesToChunk(
    module: NormalModule,
    chunk: Chunk,
    compilation: Compilation
  ): void {
    if (!compilation.chunkGraph.isModuleInChunk(module, chunk)) {
      if (this.options.debug) {
        console.log('adding ', module.identifier(), ' to chunk', chunk.name);
      }
      if (module.buildMeta) {
        module.buildMeta['eager'] = true;
      }
      compilation.chunkGraph.connectChunkAndModule(chunk, module);
    }

    module.dependencies.forEach(dependency => {
      const dependencyModule = compilation.moduleGraph.getModule(dependency);
      if (
        dependencyModule &&
        !compilation.chunkGraph.isModuleInChunk(dependencyModule, chunk)
      ) {
        this.addModuleAndDependenciesToChunk(
          dependencyModule as NormalModule,
          chunk,
          compilation
        );
      }
    });
  }

  removeDelegatesNonRuntimeChunks(
    compilation: Compilation,
    chunks: Iterable<Chunk>
  ): void {
    for (let chunk of chunks) {
      if (!chunk.hasRuntime()) {
        this.options.debug &&
          console.log(
            'non-runtime chunk:',
            chunk.debugId,
            chunk.id,
            chunk.name
          );
        this._delegateModules.forEach((module) => {
          compilation.chunkGraph.disconnectChunkAndModule(chunk, module);
        });
      }
    }
  }

  apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap(
      'DelegateModulesPlugin',
      (compilation: Compilation) => {
        compilation.hooks.finishModules.tapAsync(
          'DelegateModulesPlugin',
          (modules, callback) => {
            const { remotes } = this.options;
            const knownDelegates = new Set(
              remotes
                ? (Object.values(remotes) as string[]).map((remote: string) =>
                    remote.replace('internal ', '')
                  )
                : []
            );
            for (const module of modules) {
              const normalModule = module as NormalModule;
              if (normalModule.resource && knownDelegates.has(normalModule.resource)) {
                this._delegateModules.set(normalModule.resource, normalModule);
              }
            }
            callback();
          }
        );

        compilation.hooks.optimizeChunks.tap(
          'DelegateModulesPlugin',
          (chunks) => {
            const { runtime, container } = this.options;
            const runtimeChunk = this.getChunkByName(chunks, runtime);
            if (!runtimeChunk || !runtimeChunk.hasRuntime()) return;
            const remoteContainer = container
              ? this.getChunkByName(chunks, container)
              : null;

            this.options.debug &&
              console.log(
                remoteContainer?.name,
                runtimeChunk.name,
                this._delegateModules.size
              );
            this.addDelegatesToChunks(
              compilation,
              [remoteContainer, runtimeChunk].filter(Boolean) as Chunk[]
            );

            this.removeDelegatesNonRuntimeChunks(compilation, chunks);
          }
        );
      }
    );
  }
}

export default DelegateModulesPlugin;