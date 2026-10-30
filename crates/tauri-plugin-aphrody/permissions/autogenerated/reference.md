## Default Permission

Lets the frontend read the state of the Bun server and send it HTTP requests.
Restarting it (`allow-bun-restart`) is not granted by default.

#### This default permission set includes the following:

- `allow-bun-info`
- `allow-bun-request`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`aphrody:allow-bun-info`

</td>
<td>

Enables the bun_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aphrody:deny-bun-info`

</td>
<td>

Denies the bun_info command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aphrody:allow-bun-request`

</td>
<td>

Enables the bun_request command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aphrody:deny-bun-request`

</td>
<td>

Denies the bun_request command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aphrody:allow-bun-restart`

</td>
<td>

Enables the bun_restart command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`aphrody:deny-bun-restart`

</td>
<td>

Denies the bun_restart command without any pre-configured scope.

</td>
</tr>
</table>
