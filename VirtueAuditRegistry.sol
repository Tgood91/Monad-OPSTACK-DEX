// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IDAOBTG2.sol";

/// @title BushidoVirtueAccessControl
/// @notice The reusable access-control piece for anything that writes Bushido
/// Virtue Scores. Interfaces (like IDAOBTG2) can only describe what functions
/// exist — they can't hold rules about who's allowed to call them. This contract
/// is that missing piece: inherit it, and "only a trusted recorder can update
/// virtue scores" is baked in automatically, instead of every implementation
/// having to rebuild the same restriction from scratch.
abstract contract BushidoVirtueAccessControl is AccessControl {
    /// @notice Holders of this role are trusted to record trades and set virtue
    /// scores. This should be an off-chain scoring service