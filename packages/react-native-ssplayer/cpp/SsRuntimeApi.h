#pragma once

// The subset of libssruntime's C-API this spike calls.
//
// Declared here rather than `#include "ssruntime.h"` so the Nitro sources
// compile without the generated header being on the include path — the podspec
// and CMake do put `native/include` there, but keeping the declarations local
// means a missing/stale build-runtime.sh run fails at *link* time with an
// obvious undefined symbol instead of a confusing header error.
//
// Source of truth: SpriteStudio-SDK/libs/ssruntime/src/ffi/mod.rs (cbindgen
// emits it as native/include/ssruntime.h).

#include <cstddef>
#include <cstdint>

extern "C" {

// --- resources ---
void* ss_resource_create_copy(const unsigned char* ptr, size_t len);
void ss_resource_destroy(void* resource);

// --- context lifecycle ---
void* ss_runtime_create(void);
void ss_runtime_destroy(void* context);
bool ss_runtime_bind_resource(void* context, void* resource);
bool ss_runtime_setup_animation(void* context, const char* name);

/// `mode`: 0 = RenderMode::Direct (the SoA + DrawBatch contract this Player
/// uses), 1 = SceneGraph. Direct also skips serializing vertices/cells/deforms
/// into the FlatBuffer — see 30_core/30_render_loop.md "Notes on RenderMode".
void ss_runtime_set_render_mode(void* context, uint8_t mode);

// --- per frame ---
float ss_runtime_update(void* context, float delta);
void ss_runtime_get_frame_data(void* context, float frame_no, unsigned char** out_data,
                               size_t* out_len);
void ss_runtime_get_world_matrices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_vertices(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_local_uvs(void* context, const float** out_data, size_t* out_len);
void ss_runtime_get_cell_meta(void* context, const float** out_data, size_t* out_len);

}  // extern "C"
