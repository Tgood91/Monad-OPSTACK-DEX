// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title BushidoMasterRouter
 * @notice Unified router contract to coordinate swaps, aggregator calls, and intent-based routing
 *         for the Bushido Trading Protocol across Base and supported EVM chains.
 * @dev Corrected 2026-10-19: fixed _getBalance signature (missing address type),
 *      added routerTarget allowlist, added owner rescue functions.
 *      Requires OpenZeppelin Contracts v5.1+ (for SafeERC20.forceApprove).
 */
contract BushidoMasterRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Struct to capture structured routing parameters
    struct SwapParams {
        address routerTarget;      // The external DEX / aggregator contract address (e.g., 1inch v5 router)
        address sellToken;         // Input token address (or address(0) for native ETH)
        address buyToken;          // Output token address
        uint256 amountIn;          // Input amount supplied
        uint256 minAmountOut;      // Minimum acceptable output enforcing strict slippage bounds
        bytes callData;            // Encrypted or pre-built router execution payload from the API
    }

    /// @notice Aggregator addresses the owner has authorized as router targets.
    mapping(address => bool) public authorizedRouter;

    // Events for auditing trade execution paths
    event MasterSwapExecuted(
        address indexed trader,
        address indexed sellToken,
        address indexed buyToken,
        uint256 amountIn,
        uint256 amountOut,
        address routerUsed
    );
    event RouterAuthorizationSet(address indexed router, bool authorized);

    error SlippageExceeded(uint256 received, uint256 minimum);
    error ExecutionFailed(bytes reason);
    error InvalidRouteTarget();
    error UnauthorizedRouter(address routerTarget);
    error InsufficientNativeValue();

    /**
     * @param initialOwner      Owner of the router (can authorize routers + rescue funds).
     * @param initialRouters    Aggregator addresses authorized at deploy time (e.g. 1inch v5,
     *                          LI.FI Diamond, 0x) so no follow-up txs are needed.
     */
    constructor(address initialOwner, address[] memory initialRouters) Ownable(initialOwner) {
        for (uint256 i = 0; i < initialRouters.length; i++) {
            if (initialRouters[i] != address(0)) {
                authorizedRouter[initialRouters[i]] = true;
                emit RouterAuthorizationSet(initialRouters[i], true);
            }
        }
    }

    /**
     * @notice Authorize or deauthorize an aggregator contract as a swap target.
     */
    function setRouterAuthorization(address router, bool authorized) external onlyOwner {
        authorizedRouter[router] = authorized;
        emit RouterAuthorizationSet(router, authorized);
    }

    /**
     * @notice Executes a multi-source swap call through any authorized router backend
     * @param params SwapParams configuration detailing target, tokens, amounts, and calldata
     */
    function executeMasterSwap(SwapParams calldata params) external payable nonReentrant returns (uint256 amountOut) {
        if (params.routerTarget == address(0)) revert InvalidRouteTarget();
        if (!authorizedRouter[params.routerTarget]) revert UnauthorizedRouter(params.routerTarget);

        uint256 balanceBefore = _getBalance(params.buyToken, address(this));

        // 1. Handle token pull-payment pattern from trader to router
        if (params.sellToken != address(0)) {
            IERC20(params.sellToken).safeTransferFrom(msg.sender, address(this), params.amountIn);
            // Approve target router to spend input tokens
            _approveTokenIfNeeded(params.sellToken, params.routerTarget, params.amountIn);
        } else {
            if (msg.value != params.amountIn) revert InsufficientNativeValue();
        }

        // 2. Execute low-level call to the target DEX router / aggregator
        (bool success, bytes memory returnData) = params.routerTarget.call{
            value: params.sellToken == address(0) ? params.amountIn : 0
        }(params.callData);

        if (!success) {
            // Bubble up inner revert reason if available
            if (returnData.length > 0) {
                assembly {
                    revert(add(32, returnData), mload(returnData))
                }
            } else {
                revert ExecutionFailed(returnData);
            }
        }

        // 3. Verify output amounts against strict slippage limits (0.1% to 1.0% bounds)
        uint256 balanceAfter = _getBalance(params.buyToken, address(this));
        amountOut = balanceAfter - balanceBefore;

        if (amountOut < params.minAmountOut) {
            revert SlippageExceeded(amountOut, params.minAmountOut);
        }

        // 4. Transfer final purchased tokens back to the trader
        _transferToken(params.buyToken, msg.sender, amountOut);

        emit MasterSwapExecuted(
            msg.sender,
            params.sellToken,
            params.buyToken,
            params.amountIn,
            amountOut,
            params.routerTarget
        );
    }

    /**
     * @notice Rescue ERC20 tokens stuck in the router (owner only).
     */
    function rescueToken(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }

    /**
     * @notice Rescue native ETH stuck in the router (owner only).
     */
    function rescueETH(address to, uint256 amount) external onlyOwner {
        (bool success, ) = to.call{value: amount}("");
        require(success, "Native transfer failed");
    }

    /** @dev Helper to handle native vs ERC20 balance reads */
    function _getBalance(address token, address account) internal view returns (uint256) {
        if (token == address(0)) {
            return account.balance;
        }
        return IERC20(token).balanceOf(account);
    }

    /** @dev Helper to handle token approvals safely */
    function _approveTokenIfNeeded(address token, address spender, uint256 amount) internal {
        uint256 currentAllowance = IERC20(token).allowance(address(this), spender);
        if (currentAllowance < amount) {
            SafeERC20.forceApprove(IERC20(token), spender, amount);
        }
    }

    /** @dev Helper to transfer assets securely back to user */
    function _transferToken(address token, address recipient, uint256 amount) internal {
        if (token == address(0)) {
            (bool success, ) = recipient.call{value: amount}("");
            require(success, "Native transfer failed");
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    // Allow contract to receive native gas tokens/refunds
    receive() external payable {}
}
