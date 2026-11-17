/*
 *  WebPort.cpp
 *  Nuvie
 *
 *  See WebPort.h.
 */

#include "WebPort.h"

#ifdef __EMSCRIPTEN__
#include <emscripten.h>

static Uint32 last_yield = 0;

void web_delay(Uint32 ms)
{
	emscripten_sleep(ms);
	last_yield = SDL_GetTicks();
}

void web_idle()
{
	Uint32 now = SDL_GetTicks();
	if(now - last_yield >= 12)
	{
		emscripten_sleep(0);
		last_yield = SDL_GetTicks();
	}
}

#else

void web_delay(Uint32 ms)
{
	SDL_Delay(ms);
}

void web_idle()
{
}

#endif
