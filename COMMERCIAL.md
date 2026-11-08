# Commercial licensing

dash is dual-licensed.

- **AGPL-3.0-or-later, for everyone.** Anyone, businesses included, can use, modify and run dash for free under the terms of the [GNU AGPL v3](LICENSE). The main condition: if you modify dash and let others use it over a network, you must offer them your modified source under the same license.
- **Commercial license, on request.** For those who cannot or do not want to comply with the AGPL, for example a hotel or rental company that ships a modified dash to guests without publishing its changes.

Using an unmodified dash, or publishing your changes under the AGPL, does not need a commercial license.

## Third-party services (Spotify, TMDB, Videotéka)

- The commercial license covers dash's own code only. It grants **no rights to Spotify or TMDB services**.
- **Spotify:** Spotify's Web Playback SDK "must not be used in commercial projects without Spotify's prior written approval". Hotel, rental and other business deployments must leave the Spotify engine off (`spotify.enabled: false`, the default). See [docs/SPOTIFY.md](docs/SPOTIFY.md).
- **TMDB:** the free TMDB API is for non-commercial use with attribution. Commercial use needs the customer's own TMDB license.
- **Videotéka** (Radarr, Sonarr, qBittorrent) is meant for the owner's own household. It is not intended for hotel or business guest use, and its guest flags stay off by default. See [docs/LIBRARY.md](docs/LIBRARY.md).

## Contact

- Licensor: Matyas Odehnal, maintainer of dash.
- Commercial licensing: matoslav6@gmail.com

Terms and prices are agreed individually.

Contributions from others can be offered under the commercial license because contributors grant the maintainer that right in the [Contributor License Agreement](CLA.md).
