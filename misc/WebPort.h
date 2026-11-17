/*
 *  WebPort.h
 *  Nuvie
 *
 *  Helpers for the browser (Emscripten) build. Nuvie runs its own blocking
 *  loops, so the web build is compiled with ASYNCIFY and these functions hand
 *  control back to the browser now and then so it can draw and deliver input.
 *  On every other platform they are thin wrappers or no-ops.
 */

#ifndef __WebPort_h__
#define __WebPort_h__

#include "SDL.h"

/* Sleep for ms milliseconds, letting the browser run meanwhile. */
void web_delay(Uint32 ms);

/* Give the browser a turn if nuvie has not yielded for a while. Cheap to call
   from any busy loop. */
void web_idle();

#endif
